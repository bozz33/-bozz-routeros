export type RouterOSSupervisorState =
  | 'idle'
  | 'connecting'
  | 'online'
  | 'backoff'
  | 'stopping'
  | 'stopped';

export type RouterOSJitterStrategy = 'none' | 'full' | 'equal';

export interface RouterOSReconnectPolicy {
  readonly initialDelayMs?: number | undefined;
  readonly maxDelayMs?: number | undefined;
  readonly multiplier?: number | undefined;
  readonly jitter?: RouterOSJitterStrategy | undefined;
  /** Maximum consecutive failed reconnect attempts. Undefined means unlimited. */
  readonly maxAttempts?: number | undefined;
  /** A connection alive this long resets exponential-backoff history. */
  readonly resetAfterStableMs?: number | undefined;
}

export interface NormalizedRouterOSReconnectPolicy {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly multiplier: number;
  readonly jitter: RouterOSJitterStrategy;
  readonly maxAttempts?: number | undefined;
  readonly resetAfterStableMs: number;
}

export interface RouterOSSupervisorSnapshot {
  readonly state: RouterOSSupervisorState;
  readonly generation: bigint;
  readonly consecutiveAttempts: number;
  readonly reconnectCount: number;
  readonly connectedAt?: number | undefined;
  readonly lastConnectedAt?: number | undefined;
  readonly lastDisconnectedAt?: number | undefined;
  readonly lastErrorAt?: number | undefined;
  readonly nextRetryAt?: number | undefined;
}
