import { EventEmitter } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import type { RouterOSClientLike } from '../client/types.js';
import { RouterOSCancelledError } from '../errors.js';
import { addSafeAbortListener } from '../util/abort-listener.js';
import { createDeferred, type Deferred } from '../util/deferred.js';
import type {
  NormalizedRouterOSReconnectPolicy,
  RouterOSReconnectPolicy,
  RouterOSSupervisorSnapshot,
  RouterOSSupervisorState,
} from './types.js';

export interface RouterOSDisconnectedEvent {
  readonly at: number;
  readonly error?: unknown;
}

export interface RouterOSSupervisedClient extends RouterOSClientLike {
  on(event: 'disconnected', listener: (payload: RouterOSDisconnectedEvent) => void): this;
  off(event: 'disconnected', listener: (payload: RouterOSDisconnectedEvent) => void): this;
}

export interface RouterOSConnectionSupervisorOptions {
  readonly client: RouterOSSupervisedClient;
  readonly reconnect?: RouterOSReconnectPolicy | undefined;
  /** Deterministic injection point for tests. Must return a value in [0, 1). */
  readonly random?: (() => number) | undefined;
  /** Clock injection point for tests/embedding. */
  readonly now?: (() => number) | undefined;
}

const DEFAULT_POLICY: NormalizedRouterOSReconnectPolicy = {
  initialDelayMs: 250,
  maxDelayMs: 30_000,
  multiplier: 2,
  jitter: 'full',
  resetAfterStableMs: 30_000,
};

export function normalizeReconnectPolicy(
  policy: RouterOSReconnectPolicy = {},
): NormalizedRouterOSReconnectPolicy {
  const normalized: NormalizedRouterOSReconnectPolicy = {
    initialDelayMs: policy.initialDelayMs ?? DEFAULT_POLICY.initialDelayMs,
    maxDelayMs: policy.maxDelayMs ?? DEFAULT_POLICY.maxDelayMs,
    multiplier: policy.multiplier ?? DEFAULT_POLICY.multiplier,
    jitter: policy.jitter ?? DEFAULT_POLICY.jitter,
    resetAfterStableMs: policy.resetAfterStableMs ?? DEFAULT_POLICY.resetAfterStableMs,
    ...(policy.maxAttempts === undefined ? {} : { maxAttempts: policy.maxAttempts }),
  };

  if (!Number.isFinite(normalized.initialDelayMs) || normalized.initialDelayMs < 0) {
    throw new RangeError('initialDelayMs must be a finite non-negative number');
  }
  if (!Number.isFinite(normalized.maxDelayMs) || normalized.maxDelayMs < normalized.initialDelayMs) {
    throw new RangeError('maxDelayMs must be finite and >= initialDelayMs');
  }
  if (!Number.isFinite(normalized.multiplier) || normalized.multiplier < 1) {
    throw new RangeError('multiplier must be finite and >= 1');
  }
  if (!Number.isFinite(normalized.resetAfterStableMs) || normalized.resetAfterStableMs < 0) {
    throw new RangeError('resetAfterStableMs must be a finite non-negative number');
  }
  if (
    normalized.maxAttempts !== undefined
    && (!Number.isSafeInteger(normalized.maxAttempts) || normalized.maxAttempts <= 0)
  ) {
    throw new RangeError('maxAttempts must be a positive safe integer when provided');
  }

  return normalized;
}

export function calculateReconnectDelay(
  policy: NormalizedRouterOSReconnectPolicy,
  attempt: number,
  random: () => number = Math.random,
): number {
  if (!Number.isSafeInteger(attempt) || attempt <= 0) {
    throw new RangeError('attempt must be a positive safe integer');
  }

  const exponent = Math.min(1024, attempt - 1);
  const raw = Math.min(
    policy.maxDelayMs,
    policy.initialDelayMs * Math.pow(policy.multiplier, exponent),
  );

  if (policy.jitter === 'none') return Math.round(raw);

  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new RangeError('random() must return a finite value in [0, 1)');
  }

  if (policy.jitter === 'full') return Math.floor(raw * sample);
  return Math.floor(raw / 2 + (raw / 2) * sample);
}

interface DisconnectWait {
  readonly promise: Promise<RouterOSDisconnectedEvent>;
  cancel(): void;
}

/**
 * Optional reconnect/lifecycle supervisor for one generic RouterOS client.
 *
 * Multi-connection topologies are intentionally composed above this class by
 * creating multiple supervisors; no HotSpot- or application-specific role is
 * embedded in the SDK core.
 */
export class RouterOSConnectionSupervisor extends EventEmitter {
  readonly #client: RouterOSSupervisedClient;
  readonly #policy: NormalizedRouterOSReconnectPolicy;
  readonly #random: () => number;
  readonly #now: () => number;

  #state: RouterOSSupervisorState = 'idle';
  #generation = 0n;
  #consecutiveAttempts = 0;
  #reconnectCount = 0;
  #connectedAt: number | undefined;
  #lastConnectedAt: number | undefined;
  #lastDisconnectedAt: number | undefined;
  #lastErrorAt: number | undefined;
  #nextRetryAt: number | undefined;

  #controller: AbortController | undefined;
  #loop: Promise<void> | undefined;
  #ready: Deferred<void> | undefined;
  #readySettled = false;
  #stableTimer: NodeJS.Timeout | undefined;

  public constructor(options: RouterOSConnectionSupervisorOptions) {
    super();
    this.#client = options.client;
    this.#policy = normalizeReconnectPolicy(options.reconnect);
    this.#random = options.random ?? Math.random;
    this.#now = options.now ?? Date.now;
  }

  public get client(): RouterOSSupervisedClient {
    return this.#client;
  }

  public get state(): RouterOSSupervisorState {
    return this.#state;
  }

  public get generation(): bigint {
    return this.#generation;
  }

  public snapshot(): RouterOSSupervisorSnapshot {
    return {
      state: this.#state,
      generation: this.#generation,
      consecutiveAttempts: this.#consecutiveAttempts,
      reconnectCount: this.#reconnectCount,
      ...(this.#connectedAt === undefined ? {} : { connectedAt: this.#connectedAt }),
      ...(this.#lastConnectedAt === undefined ? {} : { lastConnectedAt: this.#lastConnectedAt }),
      ...(this.#lastDisconnectedAt === undefined
        ? {}
        : { lastDisconnectedAt: this.#lastDisconnectedAt }),
      ...(this.#lastErrorAt === undefined ? {} : { lastErrorAt: this.#lastErrorAt }),
      ...(this.#nextRetryAt === undefined ? {} : { nextRetryAt: this.#nextRetryAt }),
    };
  }

  /** Starts supervision and resolves once the first connection becomes online. */
  public start(signal?: AbortSignal): Promise<void> {
    if (this.#loop) return this.#ready?.promise ?? Promise.resolve();
    if (signal?.aborted) {
      return Promise.reject(new RouterOSCancelledError('RouterOS supervisor start aborted'));
    }

    this.#controller = new AbortController();
    const runSignal = signal
      ? AbortSignal.any([this.#controller.signal, signal])
      : this.#controller.signal;

    this.#ready = createDeferred<void>();
    this.#readySettled = false;
    this.#loop = this.#run(runSignal)
      .catch((error) => {
        if (!runSignal.aborted) {
          this.#lastErrorAt = this.#now();
          this.emit('fault', { error, at: this.#lastErrorAt });
        }
        if (!this.#readySettled) {
          this.#readySettled = true;
          this.#ready?.reject(error);
        }
      })
      .finally(() => {
        this.#clearStableTimer();
        this.#connectedAt = undefined;
        this.#nextRetryAt = undefined;
        this.#controller = undefined;
        this.#loop = undefined;
        if (this.#state !== 'stopped') this.#setState('stopped');
      });

    return this.#ready.promise;
  }

  public async stop(): Promise<void> {
    if (!this.#loop) {
      if (this.#state !== 'stopped') this.#setState('stopped');
      return;
    }

    this.#setState('stopping');
    this.#controller?.abort(new RouterOSCancelledError('RouterOS supervisor stopped'));
    try {
      await this.#client.close();
    } catch (error) {
      this.emit('fault', { error, at: this.#now() });
    }
    await this.#loop;
  }

  async #run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const disconnectWait = this.#createDisconnectWait(signal);
      this.#setState('connecting');

      try {
        await this.#client.connect(signal);
      } catch (error) {
        disconnectWait.cancel();
        if (signal.aborted) break;
        this.#lastErrorAt = this.#now();
        this.emit('connectFailure', { error, at: this.#lastErrorAt });
        this.#consecutiveAttempts += 1;
        if (this.#attemptsExhausted()) {
          throw error;
        }
        await this.#backoff(signal);
        continue;
      }

      const connectedAt = this.#now();
      this.#generation += 1n;
      this.#connectedAt = connectedAt;
      this.#lastConnectedAt = connectedAt;
      this.#nextRetryAt = undefined;
      this.#setState('online');
      this.emit('online', { generation: this.#generation, at: connectedAt });
      this.#armStableReset();

      if (!this.#readySettled) {
        this.#readySettled = true;
        this.#ready?.resolve();
      }

      let disconnected: RouterOSDisconnectedEvent;
      try {
        disconnected = await disconnectWait.promise;
      } catch (error) {
        disconnectWait.cancel();
        if (signal.aborted) break;
        throw error;
      }

      this.#clearStableTimer();
      this.#connectedAt = undefined;
      this.#lastDisconnectedAt = disconnected.at;
      if (disconnected.error !== undefined) this.#lastErrorAt = disconnected.at;
      this.#reconnectCount += 1;
      this.#consecutiveAttempts += 1;
      this.emit('offline', {
        generation: this.#generation,
        at: disconnected.at,
        ...(disconnected.error === undefined ? {} : { error: disconnected.error }),
      });

      if (this.#attemptsExhausted()) {
        throw disconnected.error ?? new Error('RouterOS reconnect attempts exhausted');
      }
      await this.#backoff(signal);
    }

    if (!this.#readySettled) {
      this.#readySettled = true;
      this.#ready?.reject(new RouterOSCancelledError('RouterOS supervisor stopped before ready'));
    }

    try {
      await this.#client.close();
    } catch (error) {
      this.emit('fault', { error, at: this.#now() });
    }
  }

  #createDisconnectWait(signal: AbortSignal): DisconnectWait {
    const deferred = createDeferred<RouterOSDisconnectedEvent>();
    let active = true;
    let removeAbort: (() => void) | undefined;

    const cleanup = () => {
      if (!active) return;
      active = false;
      this.#client.off('disconnected', onDisconnected);
      removeAbort?.();
      removeAbort = undefined;
    };
    const onDisconnected = (event: RouterOSDisconnectedEvent) => {
      cleanup();
      deferred.resolve(event);
    };
    const onAbort = () => {
      cleanup();
      deferred.reject(new RouterOSCancelledError('RouterOS supervisor wait aborted'));
    };

    this.#client.on('disconnected', onDisconnected);
    removeAbort = addSafeAbortListener(signal, onAbort);

    return { promise: deferred.promise, cancel: cleanup };
  }

  #armStableReset(): void {
    this.#clearStableTimer();
    if (this.#policy.resetAfterStableMs === 0) {
      this.#consecutiveAttempts = 0;
      return;
    }

    this.#stableTimer = setTimeout(() => {
      this.#consecutiveAttempts = 0;
      this.#stableTimer = undefined;
      this.emit('stable', { generation: this.#generation, at: this.#now() });
    }, this.#policy.resetAfterStableMs);
    this.#stableTimer.unref?.();
  }

  #clearStableTimer(): void {
    if (!this.#stableTimer) return;
    clearTimeout(this.#stableTimer);
    this.#stableTimer = undefined;
  }

  #attemptsExhausted(): boolean {
    return this.#policy.maxAttempts !== undefined
      && this.#consecutiveAttempts >= this.#policy.maxAttempts;
  }

  async #backoff(signal: AbortSignal): Promise<void> {
    const attempt = Math.max(1, this.#consecutiveAttempts);
    const delayMs = calculateReconnectDelay(this.#policy, attempt, this.#random);
    const now = this.#now();
    this.#nextRetryAt = now + delayMs;
    this.#setState('backoff');
    this.emit('retryScheduled', { attempt, delayMs, at: now, nextRetryAt: this.#nextRetryAt });

    if (delayMs <= 0) return;
    try {
      await sleep(delayMs, undefined, { signal, ref: false });
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      this.#nextRetryAt = undefined;
    }
  }

  #setState(next: RouterOSSupervisorState): void {
    if (this.#state === next) return;
    const previous = this.#state;
    this.#state = next;
    this.emit('state', { previous, current: next, at: this.#now() });
  }
}
