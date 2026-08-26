import { EventEmitter } from 'node:events';
import { SentenceDecoder, type SentenceDecoderOptions } from '../codec/sentence.js';
import {
  RouterOSAmbiguousWriteError,
  RouterOSAuthenticationError,
  RouterOSCancelledError,
  RouterOSConnectionError,
  RouterOSFatalError,
  RouterOSProtocolError,
  RouterOSTimeoutError,
  RouterOSTrapError,
} from '../errors.js';
import { CommandStateMachine } from '../protocol/command-state-machine.js';
import { parseReply } from '../protocol/reply-parser.js';
import type {
  RouterOSCommandResult,
  RouterOSReply,
  RouterOSTrapReply,
} from '../protocol/reply.js';
import { TagRegistry, type RouterOSTagKind } from '../protocol/tag-registry.js';
import { SocketTransport } from '../transport/socket-transport.js';
import type { RouterOSTransport, RouterOSTransportOptions } from '../transport/types.js';
import { createDeferred, type Deferred } from '../util/deferred.js';
import { buildCommandSentence, normalizeCommand } from './command.js';
import { RouterOSStreamController } from './stream.js';
import type {
  RouterOSClientLike,
  RouterOSCommandOptions,
  RouterOSListenOptions,
  RouterOSMutationKind,
  RouterOSStream,
  RouterOSStreamOverflowPolicy,
} from './types.js';

export interface RouterOSClientOptions extends RouterOSTransportOptions {
  readonly username?: string;
  readonly password?: string;
  readonly commandTimeoutMs?: number;
  readonly decoder?: SentenceDecoderOptions;
  readonly streamMaxQueuedReplies?: number;
  readonly streamOverflowPolicy?: RouterOSStreamOverflowPolicy;
  /** Dependency-injection hook for tests, tunnels, or custom transports. */
  readonly transport?: RouterOSTransport;
}

interface PendingCommand {
  readonly command: string;
  readonly kind: Exclude<RouterOSMutationKind, 'auto'>;
  readonly stateMachine: CommandStateMachine;
  readonly result: Deferred<RouterOSCommandResult>;
  timer?: NodeJS.Timeout;
  removeAbort?: () => void;
  dispatched: boolean;
}

interface CancelCoordinator {
  readonly targetTag: string;
  readonly cancelTag: string;
  readonly deferred: Deferred<void>;
  targetDone: boolean;
  cancelDone: boolean;
  protocolComplete: boolean;
  error?: unknown;
  timer?: NodeJS.Timeout;
  removeAbort?: () => void;
}

interface PendingListener {
  readonly command: string;
  readonly stream: RouterOSStreamController;
  readonly traps: RouterOSTrapReply[];
  cancel?: CancelCoordinator;
  removeAbort?: () => void;
}

interface PendingCancel {
  readonly stateMachine: CommandStateMachine;
  readonly coordinator: CancelCoordinator;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
const DEFAULT_STREAM_QUEUE = 4096;
const DEFAULT_STREAM_OVERFLOW: RouterOSStreamOverflowPolicy = 'error';

const READ_COMMAND_LEAVES = new Set([
  'print',
  'getall',
  'get',
  'monitor',
  'monitor-traffic',
  'ping',
  'traceroute',
  'scan',
  'torch',
]);

function commandLeaf(command: string): string {
  const segments = normalizeCommand(command).split('/').filter(Boolean);
  return segments.at(-1) ?? '';
}

/** Conservative auto-classification used only for failure/retry semantics. */
export function classifyCommandKind(
  command: string,
  requested: RouterOSMutationKind = 'auto',
): Exclude<RouterOSMutationKind, 'auto'> {
  if (requested !== 'auto') return requested;

  const normalized = normalizeCommand(command);
  if (normalized === '/login' || normalized === '/cancel' || normalized === '/quit') {
    return 'control';
  }
  if (READ_COMMAND_LEAVES.has(commandLeaf(normalized))) return 'read';

  // Unknown commands are conservatively considered mutations. A false
  // ambiguous-write is safer than blindly replaying an unknown mutation.
  return 'write';
}

function asConnectionError(error: unknown): RouterOSConnectionError {
  return error instanceof RouterOSConnectionError
    ? error
    : new RouterOSConnectionError('RouterOS connection failed', { cause: error });
}

/** Generic RouterOS 7.x binary API client for Node.js/TypeScript. */
export class RouterOSClient extends EventEmitter implements RouterOSClientLike {
  readonly #options: RouterOSClientOptions;
  readonly #transport: RouterOSTransport;
  readonly #decoder: SentenceDecoder;
  readonly #tags = new TagRegistry();
  readonly #commands = new Map<string, PendingCommand>();
  readonly #listeners = new Map<string, PendingListener>();
  readonly #cancels = new Map<string, PendingCancel>();

  #authenticated = false;
  #loginPromise: Promise<void> | undefined;

  public constructor(options: RouterOSClientOptions) {
    super();
    this.#options = options;
    this.#transport = options.transport ?? new SocketTransport(options);
    this.#decoder = new SentenceDecoder(options.decoder);

    this.#transport.on('data', ({ chunk }) => this.#handleData(chunk));
    this.#transport.on('fault', ({ error, at }) => {
      this.emit('transportFault', { error, at });
    });
    this.#transport.on('connected', ({ at }) => {
      this.emit('connected', { at });
    });
    this.#transport.on('disconnected', ({ error, at }) => {
      this.#authenticated = false;
      this.#decoder.reset();
      const failure = error === undefined
        ? new RouterOSConnectionError('RouterOS connection closed')
        : asConnectionError(error);
      this.#failAll(failure);
      this.emit('disconnected', { at, ...(error === undefined ? {} : { error }) });
    });
  }

  public get connected(): boolean {
    return this.#transport.connected;
  }

  public get authenticated(): boolean {
    return this.#authenticated;
  }

  public get pendingTags(): number {
    return this.#tags.size;
  }

  public async connect(signal?: AbortSignal): Promise<void> {
    await this.#transport.connect(signal);
    if (this.#options.username !== undefined && !this.#authenticated) {
      await this.#performLogin(this.#options.username, this.#options.password ?? '', signal);
    }
  }

  public async login(username: string, password: string, signal?: AbortSignal): Promise<void> {
    await this.#transport.connect(signal);
    await this.#performLogin(username, password, signal);
  }

  async #performLogin(username: string, password: string, signal?: AbortSignal): Promise<void> {
    if (this.#authenticated) return;
    if (this.#loginPromise) return this.#loginPromise;

    this.#loginPromise = (async () => {
      try {
        await this.#executeConnected('/login', {
          attributes: { name: username, password },
          kind: 'control',
          signal,
        });
        this.#authenticated = true;
      } catch (error) {
        if (error instanceof RouterOSTrapError || error instanceof RouterOSFatalError) {
          throw new RouterOSAuthenticationError('RouterOS authentication failed', { cause: error });
        }
        throw error;
      }
    })().finally(() => {
      this.#loginPromise = undefined;
    });

    return this.#loginPromise;
  }

  public async execute(
    command: string,
    options: RouterOSCommandOptions = {},
  ): Promise<RouterOSCommandResult> {
    if (options.signal?.aborted) {
      throw new RouterOSCancelledError(`RouterOS command aborted before dispatch: ${command}`);
    }
    await this.connect(options.signal);
    return this.#executeConnected(command, options);
  }

  async #executeConnected(
    command: string,
    options: RouterOSCommandOptions = {},
  ): Promise<RouterOSCommandResult> {
    if (!this.#transport.connected) {
      throw new RouterOSConnectionError('RouterOS transport is not connected');
    }

    const normalized = normalizeCommand(command);
    const kind = classifyCommandKind(normalized, options.kind ?? 'auto');
    const tag = this.#reserveTag('command', options.tag, 'C');
    const result = createDeferred<RouterOSCommandResult>();
    const pending: PendingCommand = {
      command: normalized,
      kind,
      stateMachine: new CommandStateMachine(tag),
      result,
      dispatched: false,
    };

    this.#commands.set(tag, pending);
    this.#armCommandLifecycle(tag, pending, options);

    try {
      pending.dispatched = true;
      await this.#transport.write(
        buildCommandSentence(
          normalized,
          tag,
          options.attributes,
          options.apiAttributes,
          options.queries,
        ),
        options.signal,
      );
    } catch (error) {
      const failure = kind === 'write' && pending.dispatched
        ? new RouterOSAmbiguousWriteError(
            `RouterOS write outcome is ambiguous for ${normalized}`,
            normalized,
            { cause: error },
          )
        : error;
      this.#rejectCommand(tag, failure);
    }

    return result.promise;
  }

  public async print(
    command: string,
    options: RouterOSCommandOptions = {},
  ): Promise<readonly Record<string, string>[]> {
    const normalized = normalizeCommand(command);
    const printCommand = normalized.endsWith('/print') ? normalized : `${normalized}/print`;
    const result = await this.execute(printCommand, {
      ...options,
      kind: options.kind ?? 'read',
    });
    return result.records;
  }

  public async listen(
    command: string,
    options: RouterOSListenOptions = {},
  ): Promise<RouterOSStream> {
    if (options.signal?.aborted) {
      throw new RouterOSCancelledError(`RouterOS listen aborted before dispatch: ${command}`);
    }

    await this.connect(options.signal);
    const normalized = normalizeCommand(command);
    const listenCommand = normalized.endsWith('/listen') ? normalized : `${normalized}/listen`;
    const tag = this.#reserveTag('listen', options.tag, 'L');

    const stream = new RouterOSStreamController(tag, {
      maxQueuedReplies:
        options.maxQueuedReplies ?? this.#options.streamMaxQueuedReplies ?? DEFAULT_STREAM_QUEUE,
      overflowPolicy:
        options.overflowPolicy ?? this.#options.streamOverflowPolicy ?? DEFAULT_STREAM_OVERFLOW,
      cancel: (signal) => this.#cancelListener(tag, signal),
    });

    const pending: PendingListener = {
      command: listenCommand,
      stream,
      traps: [],
    };
    this.#listeners.set(tag, pending);

    try {
      await this.#transport.write(
        buildCommandSentence(
          listenCommand,
          tag,
          options.attributes,
          options.apiAttributes,
          options.queries,
        ),
        options.signal,
      );
    } catch (error) {
      this.#cleanupListener(tag);
      stream.finish(error);
      throw error;
    }

    if (options.signal) {
      const onAbort = () => {
        void stream.cancel().catch((error) => {
          this.emit('protocolError', { error, tag, command: listenCommand });
        });
      };
      options.signal.addEventListener('abort', onAbort, { once: true });
      pending.removeAbort = () => options.signal?.removeEventListener('abort', onAbort);
      if (options.signal.aborted) onAbort();
    }

    return stream;
  }

  async #cancelListener(targetTag: string, signal?: AbortSignal): Promise<void> {
    const listener = this.#listeners.get(targetTag);
    if (!listener || listener.stream.closed) return;
    if (listener.cancel) return listener.cancel.deferred.promise;
    if (signal?.aborted) {
      throw new RouterOSCancelledError(`Cancellation aborted for RouterOS listener ${targetTag}`);
    }

    const cancelTag = this.#reserveTag('cancel', undefined, 'X');
    const coordinator: CancelCoordinator = {
      targetTag,
      cancelTag,
      deferred: createDeferred<void>(),
      targetDone: false,
      cancelDone: false,
      protocolComplete: false,
    };
    listener.cancel = coordinator;
    this.#cancels.set(cancelTag, {
      stateMachine: new CommandStateMachine(cancelTag),
      coordinator,
    });
    this.#armCancelWait(coordinator, signal);

    try {
      await this.#transport.write(
        buildCommandSentence('/cancel', cancelTag, { tag: targetTag }),
        signal,
      );
    } catch (error) {
      // `/cancel` itself may have reached RouterOS even if the local write
      // acknowledgement failed. Keep both tags registered so late terminal
      // replies are consumed correctly rather than becoming process errors.
      coordinator.error = error;
    }

    return coordinator.deferred.promise;
  }

  #armCancelWait(coordinator: CancelCoordinator, signal?: AbortSignal): void {
    const timeoutMs = this.#options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    if (timeoutMs > 0) {
      coordinator.timer = setTimeout(() => {
        coordinator.deferred.reject(
          new RouterOSTimeoutError(
            `Timed out waiting for RouterOS listener ${coordinator.targetTag} cancellation lifecycle`,
          ),
        );
      }, timeoutMs);
      coordinator.timer.unref?.();
    }

    if (signal) {
      const onAbort = () => {
        coordinator.deferred.reject(
          new RouterOSCancelledError(
            `Cancelled while waiting for RouterOS listener ${coordinator.targetTag} to stop`,
          ),
        );
      };
      signal.addEventListener('abort', onAbort, { once: true });
      coordinator.removeAbort = () => signal.removeEventListener('abort', onAbort);
      if (signal.aborted) onAbort();
    }
  }

  #completeCancel(coordinator: CancelCoordinator): void {
    if (!coordinator.targetDone || !coordinator.cancelDone || coordinator.protocolComplete) return;
    coordinator.protocolComplete = true;
    if (coordinator.timer) clearTimeout(coordinator.timer);
    coordinator.removeAbort?.();
    if (coordinator.error !== undefined) coordinator.deferred.reject(coordinator.error);
    else coordinator.deferred.resolve();
  }

  #handleData(chunk: Buffer): void {
    try {
      for (const sentence of this.#decoder.push(chunk)) {
        const reply = parseReply(sentence);
        this.emit('reply', reply);
        this.#dispatchReply(reply);
      }
    } catch (error) {
      const protocolError = error instanceof RouterOSProtocolError
        ? error
        : new RouterOSProtocolError('Failed processing RouterOS binary API data', { cause: error });
      this.emit('protocolError', { error: protocolError });
      this.#failAll(protocolError);
      void this.#transport.close();
    }
  }

  #dispatchReply(reply: RouterOSReply): void {
    if (reply.type === 'fatal' && reply.tag === undefined) {
      this.#handleFatal(reply);
      return;
    }

    const tag = reply.tag;
    if (tag === undefined) {
      this.emit('orphanReply', { reply, observedAt: Date.now(), reason: 'missing-tag' });
      return;
    }

    const entry = this.#tags.get(tag);
    if (!entry) {
      this.emit('orphanReply', { reply, observedAt: Date.now(), reason: 'unknown-tag' });
      if (reply.type === 'fatal') this.#handleFatal(reply);
      return;
    }

    switch (entry.kind) {
      case 'command':
        this.#handleCommandReply(tag, reply);
        break;
      case 'listen':
        this.#handleListenerReply(tag, reply);
        break;
      case 'cancel':
        this.#handleCancelReply(tag, reply);
        break;
    }
  }

  #handleCommandReply(tag: string, reply: RouterOSReply): void {
    const pending = this.#commands.get(tag);
    if (!pending) {
      this.emit('orphanReply', { reply, observedAt: Date.now(), reason: 'missing-command' });
      return;
    }

    try {
      const result = pending.stateMachine.accept(reply);
      if (result !== undefined) this.#resolveCommand(tag, result);
    } catch (error) {
      this.#rejectCommand(tag, error);
      if (error instanceof RouterOSFatalError) this.#failAll(error);
    }
  }

  #handleListenerReply(tag: string, reply: RouterOSReply): void {
    const listener = this.#listeners.get(tag);
    if (!listener) {
      this.emit('orphanReply', { reply, observedAt: Date.now(), reason: 'missing-listener' });
      return;
    }

    switch (reply.type) {
      case 're':
      case 'empty':
        listener.stream.push(reply);
        return;

      case 'trap':
        listener.traps.push(reply);
        listener.stream.push(reply);
        return;

      case 'fatal':
        this.#handleFatal(reply);
        return;

      case 'done': {
        const coordinator = listener.cancel;
        this.#cleanupListener(tag);

        if (coordinator) {
          listener.stream.finish();
          coordinator.targetDone = true;
          this.#completeCancel(coordinator);
          return;
        }

        if (listener.traps.length > 0) {
          listener.stream.finish(
            new RouterOSTrapError(
              listener.traps[0]?.attributes.message ?? `RouterOS listener ${tag} trapped`,
              [...listener.traps],
            ),
          );
        } else {
          listener.stream.finish();
        }
      }
    }
  }

  #handleCancelReply(tag: string, reply: RouterOSReply): void {
    const pending = this.#cancels.get(tag);
    if (!pending) {
      this.emit('orphanReply', { reply, observedAt: Date.now(), reason: 'missing-cancel' });
      return;
    }

    try {
      const result = pending.stateMachine.accept(reply);
      if (result === undefined) return;
      pending.coordinator.cancelDone = true;
      this.#cancels.delete(tag);
      this.#tags.release(tag);
      this.#completeCancel(pending.coordinator);
    } catch (error) {
      pending.coordinator.error = error;
      if (reply.type === 'done' || reply.type === 'fatal') {
        pending.coordinator.cancelDone = true;
        this.#cancels.delete(tag);
        this.#tags.release(tag);
        this.#completeCancel(pending.coordinator);
      }
      if (error instanceof RouterOSFatalError) this.#failAll(error);
    }
  }

  #handleFatal(reply: Extract<RouterOSReply, { type: 'fatal' }>): void {
    const error = new RouterOSFatalError(
      reply.attributes.message ?? 'RouterOS fatal reply',
      reply,
    );
    this.#failAll(error);
    void this.#transport.close();
  }

  #armCommandLifecycle(
    tag: string,
    pending: PendingCommand,
    options: RouterOSCommandOptions,
  ): void {
    const timeoutMs = options.timeoutMs ?? this.#options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    if (timeoutMs > 0) {
      pending.timer = setTimeout(() => {
        const error = pending.kind === 'write' && pending.dispatched
          ? new RouterOSAmbiguousWriteError(
              `RouterOS write acknowledgement timed out for ${pending.command}`,
              pending.command,
            )
          : new RouterOSTimeoutError(`RouterOS command timed out: ${pending.command}`);
        this.#rejectCommand(tag, error);
      }, timeoutMs);
      pending.timer.unref?.();
    }

    if (options.signal) {
      const onAbort = () => {
        const error = pending.kind === 'write' && pending.dispatched
          ? new RouterOSAmbiguousWriteError(
              `RouterOS write was aborted after dispatch: ${pending.command}`,
              pending.command,
            )
          : new RouterOSCancelledError(`RouterOS command aborted: ${pending.command}`);
        this.#rejectCommand(tag, error);
      };
      options.signal.addEventListener('abort', onAbort, { once: true });
      pending.removeAbort = () => options.signal?.removeEventListener('abort', onAbort);
      if (options.signal.aborted) onAbort();
    }
  }

  #resolveCommand(tag: string, result: RouterOSCommandResult): void {
    const pending = this.#commands.get(tag);
    if (!pending) return;
    this.#cleanupCommand(tag, pending);
    pending.result.resolve(result);
  }

  #rejectCommand(tag: string, error: unknown): void {
    const pending = this.#commands.get(tag);
    if (!pending) return;
    this.#cleanupCommand(tag, pending);
    pending.result.reject(error);
  }

  #cleanupCommand(tag: string, pending: PendingCommand): void {
    if (pending.timer) clearTimeout(pending.timer);
    pending.removeAbort?.();
    this.#commands.delete(tag);
    this.#tags.release(tag);
  }

  #cleanupListener(tag: string): void {
    const listener = this.#listeners.get(tag);
    listener?.removeAbort?.();
    this.#listeners.delete(tag);
    this.#tags.release(tag);
  }

  #reserveTag(kind: RouterOSTagKind, requested: string | undefined, prefix: string): string {
    if (requested !== undefined) {
      if (requested.trim() === '') throw new TypeError('RouterOS tag must not be empty');
      this.#tags.register({
        tag: requested,
        kind,
        createdAt: Date.now(),
        context: undefined,
      });
      return requested;
    }
    return this.#tags.allocate(kind, undefined, prefix).tag;
  }

  #failAll(error: unknown): void {
    const connectionError = error instanceof RouterOSFatalError || error instanceof RouterOSProtocolError
      ? error
      : asConnectionError(error);

    for (const [tag, pending] of [...this.#commands]) {
      const failure = pending.kind === 'write' && pending.dispatched
        ? new RouterOSAmbiguousWriteError(
            `RouterOS connection ended before write acknowledgement: ${pending.command}`,
            pending.command,
            { cause: connectionError },
          )
        : connectionError;
      this.#rejectCommand(tag, failure);
    }

    for (const [tag, listener] of [...this.#listeners]) {
      listener.removeAbort?.();
      listener.stream.finish(connectionError);
      this.#listeners.delete(tag);
      this.#tags.release(tag);
    }

    for (const [tag, pending] of [...this.#cancels]) {
      if (pending.coordinator.timer) clearTimeout(pending.coordinator.timer);
      pending.coordinator.removeAbort?.();
      pending.coordinator.deferred.reject(connectionError);
      this.#cancels.delete(tag);
      this.#tags.release(tag);
    }

    this.#tags.clear();
  }

  public async close(): Promise<void> {
    const closing = new RouterOSCancelledError('RouterOS client closed');
    this.#failAll(closing);
    this.#authenticated = false;
    this.#decoder.reset();
    await this.#transport.close();
  }
}
