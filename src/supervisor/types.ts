export type RouterOSConnectionRole = 'control' | 'active-listen' | 'user-listen';

export type RouterOSConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'listening'
  | 'degraded'
  | 'reconnecting'
  | 'closing';

export interface RouterOSReconnectPolicy {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly multiplier: number;
  readonly jitterRatio: number;
  readonly maxAttempts?: number;
}

export interface RouterOSConnectionHealth {
  readonly role: RouterOSConnectionRole;
  readonly state: RouterOSConnectionState;
  readonly connectedAt?: number;
  readonly lastReplyAt?: number;
  readonly lastErrorAt?: number;
  readonly reconnectCount: number;
  readonly pendingTags: number;
}

export interface RouterOSSupervisorSnapshot {
  readonly generation: bigint;
  readonly control: RouterOSConnectionHealth;
  readonly active: RouterOSConnectionHealth;
  readonly users: RouterOSConnectionHealth;
}
