import {
  RouterOSCancelledError,
  RouterOSStreamOverflowError,
  RouterOSTimeoutError,
} from '../errors.js';
import type { RouterOSReply } from '../protocol/reply.js';
import { createDeferred, type Deferred } from '../util/deferred.js';
import type { RouterOSStream, RouterOSStreamOverflowPolicy } from './types.js';

interface Waiter {
  readonly deferred: Deferred<IteratorResult<RouterOSReply>>;
  readonly cleanup: () => void;
}

export interface RouterOSStreamControllerOptions {
  readonly maxQueuedReplies: number;
  readonly overflowPolicy: RouterOSStreamOverflowPolicy;
  readonly cancel: (signal?: AbortSignal) => Promise<void>;
}

/** Internal bounded AsyncIterator used by RouterOS long-running commands. */
export class RouterOSStreamController implements RouterOSStream {
  readonly #queue: RouterOSReply[] = [];
  readonly #waiters: Waiter[] = [];
  readonly #options: RouterOSStreamControllerOptions;
  #closed = false;
  #closeError: unknown;
  #overflowCancelStarted = false;

  public constructor(
    public readonly tag: string,
    options: RouterOSStreamControllerOptions,
  ) {
    if (!Number.isSafeInteger(options.maxQueuedReplies) || options.maxQueuedReplies <= 0) {
      throw new RangeError('maxQueuedReplies must be a positive safe integer');
    }
    this.#options = options;
  }

  public get closed(): boolean {
    return this.#closed;
  }

  public get queuedReplies(): number {
    return this.#queue.length;
  }

  public push(reply: RouterOSReply): void {
    if (this.#closed) return;

    const waiter = this.#waiters.shift();
    if (waiter) {
      waiter.cleanup();
      waiter.deferred.resolve({ value: reply, done: false });
      return;
    }

    if (this.#queue.length >= this.#options.maxQueuedReplies) {
      if (this.#options.overflowPolicy === 'drop-oldest') {
        this.#queue.shift();
      } else {
        const overflow = new RouterOSStreamOverflowError(
          `RouterOS stream ${this.tag} exceeded ${this.#options.maxQueuedReplies} queued replies`,
        );
        // Start the RouterOS `/cancel` lifecycle while the listener is still
        // registered/open locally. The cancellation promise is intentionally
        // detached because the consumer-facing failure is the overflow itself.
        this.#cancelAfterOverflow();
        this.finish(overflow);
        return;
      }
    }

    this.#queue.push(reply);
  }

  #cancelAfterOverflow(): void {
    if (this.#overflowCancelStarted) return;
    this.#overflowCancelStarted = true;

    // If cancellation itself fails, the transport/supervisor owns connection-
    // level recovery. Absorb the detached promise to avoid an unhandled
    // rejection while preserving RouterOSStreamOverflowError for the consumer.
    void this.#options.cancel().catch(() => undefined);
  }

  public finish(error?: unknown): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#closeError = error;

    while (this.#waiters.length > 0) {
      const waiter = this.#waiters.shift();
      if (!waiter) continue;
      waiter.cleanup();
      if (error !== undefined) waiter.deferred.reject(error);
      else waiter.deferred.resolve({ value: undefined, done: true });
    }
  }

  public async nextReply(
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<RouterOSReply | undefined> {
    const queued = this.#queue.shift();
    if (queued) return queued;

    if (this.#closed) {
      if (this.#closeError !== undefined) throw this.#closeError;
      return undefined;
    }
    if (signal?.aborted) {
      throw new RouterOSCancelledError(`RouterOS stream ${this.tag} wait aborted`);
    }

    const deferred = createDeferred<IteratorResult<RouterOSReply>>();
    let timer: NodeJS.Timeout | undefined;
    let waiter: Waiter | undefined;

    const removeWaiter = () => {
      if (!waiter) return;
      const index = this.#waiters.indexOf(waiter);
      if (index >= 0) this.#waiters.splice(index, 1);
    };

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      removeWaiter();
      cleanup();
      deferred.reject(new RouterOSCancelledError(`RouterOS stream ${this.tag} wait aborted`));
    };

    waiter = { deferred, cleanup };
    this.#waiters.push(waiter);

    if (timeoutMs !== undefined && timeoutMs > 0) {
      timer = setTimeout(() => {
        removeWaiter();
        cleanup();
        deferred.reject(
          new RouterOSTimeoutError(`Timed out waiting for RouterOS stream ${this.tag}`),
        );
      }, timeoutMs);
      timer.unref?.();
    }

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();

    const result = await deferred.promise;
    return result.done ? undefined : result.value;
  }

  public async cancel(signal?: AbortSignal): Promise<void> {
    // Even a locally closed stream may still have a remote RouterOS listener
    // that needs cancellation. The client callback is idempotent when the
    // RouterOS-side lifecycle is already complete.
    await this.#options.cancel(signal);
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<RouterOSReply> {
    while (true) {
      const reply = await this.nextReply();
      if (!reply) return;
      yield reply;
    }
  }
}
