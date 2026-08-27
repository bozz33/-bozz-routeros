import { EventEmitter } from 'node:events';
import net from 'node:net';
import tls from 'node:tls';
import { RouterOSCancelledError, RouterOSConnectionError } from '../errors.js';
import { addSafeAbortListener } from '../util/abort-listener.js';
import type {
  RouterOSSocket,
  RouterOSTransport,
  RouterOSTransportKind,
  RouterOSTransportOptions,
  RouterOSTlsOptions,
} from './types.js';

function defaultPort(kind: RouterOSTransportKind): number {
  return kind === 'tls' ? 8729 : 8728;
}

/**
 * Resolve the TLS SNI server name according to Node.js `tls.connect()` rules.
 * DNS names use SNI by default; IP literals do not. An explicit empty string
 * remains a supported way for callers to disable SNI.
 */
export function resolveTlsServername(
  host: string,
  tlsOptions: RouterOSTlsOptions,
): string | undefined {
  const explicit = tlsOptions.servername;
  if (explicit !== undefined) {
    if (explicit !== '' && net.isIP(explicit) !== 0) {
      throw new TypeError('TLS servername must be a DNS hostname, not an IP address');
    }
    return explicit;
  }

  return net.isIP(host) === 0 ? host : undefined;
}

/** Native Node.js byte transport for the RouterOS binary API. */
export class SocketTransport extends EventEmitter implements RouterOSTransport {
  readonly #options: RouterOSTransportOptions;
  #socket: RouterOSSocket | undefined;
  #connectPromise: Promise<void> | undefined;
  #connected = false;
  #lastError: unknown;
  #writeTail: Promise<void> = Promise.resolve();

  public constructor(options: RouterOSTransportOptions) {
    super();
    this.#options = options;
  }

  public get kind(): RouterOSTransportKind {
    return this.#options.kind ?? (this.#options.tls ? 'tls' : 'tcp');
  }

  public get connected(): boolean {
    return this.#connected && this.#socket !== undefined && !this.#socket.destroyed;
  }

  public async connect(signal?: AbortSignal): Promise<void> {
    if (this.connected) return;
    if (signal?.aborted) {
      throw new RouterOSCancelledError('RouterOS connection aborted before connect');
    }
    if (this.#connectPromise) return this.#connectPromise;

    this.#connectPromise = this.#open(signal).finally(() => {
      this.#connectPromise = undefined;
    });
    return this.#connectPromise;
  }

  async #open(signal?: AbortSignal): Promise<void> {
    const kind = this.kind;
    const port = this.#options.port ?? defaultPort(kind);
    const connectTimeoutMs = this.#options.connectTimeoutMs ?? 10_000;
    if (!Number.isFinite(connectTimeoutMs) || connectTimeoutMs <= 0) {
      throw new RangeError('connectTimeoutMs must be greater than zero');
    }

    let socket: RouterOSSocket;
    if (kind === 'tls') {
      const tlsOptions = this.#options.tls ?? {};
      const servername = resolveTlsServername(this.#options.host, tlsOptions);
      socket = tls.connect({
        ...tlsOptions,
        host: this.#options.host,
        port,
        ...(servername === undefined ? {} : { servername }),
        ...(this.#options.localAddress === undefined
          ? {}
          : { localAddress: this.#options.localAddress }),
        ...(this.#options.localPort === undefined ? {} : { localPort: this.#options.localPort }),
      });
    } else {
      socket = net.createConnection({
        host: this.#options.host,
        port,
        ...(this.#options.localAddress === undefined
          ? {}
          : { localAddress: this.#options.localAddress }),
        ...(this.#options.localPort === undefined ? {} : { localPort: this.#options.localPort }),
      });
    }

    this.#socket = socket;
    this.#lastError = undefined;
    const connectEvent = kind === 'tls' ? 'secureConnect' : 'connect';

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let removeAbort: (() => void) | undefined;
      const timeout = setTimeout(() => {
        finishReject(
          new RouterOSConnectionError(
            `Timed out connecting to RouterOS ${this.#options.host}:${port}`,
          ),
        );
      }, connectTimeoutMs);
      timeout.unref?.();

      const cleanup = () => {
        clearTimeout(timeout);
        socket.off(connectEvent, onConnected);
        socket.off('error', onInitialError);
        removeAbort?.();
        removeAbort = undefined;
      };

      const finishResolve = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        socket.destroy();
        reject(error);
      };

      const onConnected = () => finishResolve();
      const onInitialError = (error: Error) => {
        finishReject(
          new RouterOSConnectionError(
            `Failed connecting to RouterOS ${this.#options.host}:${port}`,
            { cause: error },
          ),
        );
      };
      const onAbort = () => {
        finishReject(new RouterOSCancelledError('RouterOS connection aborted'));
      };

      socket.once(connectEvent, onConnected);
      socket.once('error', onInitialError);
      if (signal) removeAbort = addSafeAbortListener(signal, onAbort);
    });

    this.#configureSocket(socket);
    this.#connected = true;
    this.#bindRuntimeEvents(socket);
    this.emit('connected', { at: Date.now() });
  }

  #configureSocket(socket: RouterOSSocket): void {
    socket.setNoDelay(this.#options.noDelay ?? true);

    if (this.#options.keepAlive ?? true) {
      socket.setKeepAlive({
        enable: true,
        initialDelay: this.#options.keepAliveInitialDelayMs ?? 15_000,
        interval: this.#options.keepAliveIntervalMs ?? 5_000,
        count: this.#options.keepAliveProbeCount ?? 3,
      });
    } else {
      socket.setKeepAlive(false);
    }
  }

  #bindRuntimeEvents(socket: RouterOSSocket): void {
    socket.on('data', (chunk: Buffer) => {
      this.emit('data', { chunk, at: Date.now() });
    });

    socket.on('error', (error) => {
      this.#lastError = error;
      // `fault` is intentional. Emitting EventEmitter's special `error`
      // without a listener can terminate the host process.
      this.emit('fault', { error, at: Date.now() });
    });

    socket.on('close', () => {
      if (this.#socket === socket) {
        this.#socket = undefined;
      }
      const wasConnected = this.#connected;
      this.#connected = false;
      if (wasConnected) {
        this.emit('disconnected', {
          at: Date.now(),
          ...(this.#lastError === undefined ? {} : { error: this.#lastError }),
        });
      }
      this.#lastError = undefined;
    });
  }

  public write(data: Uint8Array, signal?: AbortSignal): Promise<void> {
    const queued = this.#writeTail.then(() => this.#writeOne(data, signal));
    // Keep the physical socket write lane alive after a failed write. The
    // failed caller still receives its own rejection.
    this.#writeTail = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  async #writeOne(data: Uint8Array, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new RouterOSCancelledError('RouterOS write aborted before dispatch');
    }

    const socket = this.#socket;
    if (!socket || !this.connected) {
      throw new RouterOSConnectionError('RouterOS transport is not connected');
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let removeAbort: (() => void) | undefined;
      const cleanup = () => {
        socket.off('error', onError);
        removeAbort?.();
        removeAbort = undefined;
      };
      const finishResolve = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const finishReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          error instanceof RouterOSCancelledError
            ? error
            : new RouterOSConnectionError('RouterOS socket write failed', { cause: error }),
        );
      };
      const onError = (error: Error) => finishReject(error);
      const onAbort = () => finishReject(new RouterOSCancelledError('RouterOS write aborted'));

      socket.once('error', onError);
      if (signal) removeAbort = addSafeAbortListener(signal, onAbort);

      try {
        socket.write(data, (error?: Error | null) => {
          if (error) finishReject(error);
          else finishResolve();
        });
      } catch (error) {
        finishReject(error);
      }
    });
  }

  public async close(): Promise<void> {
    const socket = this.#socket;
    this.#socket = undefined;
    this.#connected = false;
    if (!socket || socket.destroyed) return;

    await new Promise<void>((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        resolve();
      };
      const forceTimer = setTimeout(() => {
        if (!socket.destroyed) socket.destroy();
        done();
      }, 250);
      forceTimer.unref?.();

      socket.once('close', () => {
        clearTimeout(forceTimer);
        done();
      });
      socket.end();
    });
  }
}
