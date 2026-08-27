import type { Socket } from 'node:net';
import type { ConnectionOptions as TlsConnectionOptions, TLSSocket } from 'node:tls';

export type RouterOSSocket = Socket | TLSSocket;
export type RouterOSTransportKind = 'tcp' | 'tls';
export type RouterOSTlsOptions = Omit<TlsConnectionOptions, 'host' | 'port'>;

export interface RouterOSTransportOptions {
  readonly host: string;
  readonly port?: number;
  readonly kind?: RouterOSTransportKind;
  readonly connectTimeoutMs?: number;
  readonly keepAlive?: boolean;
  readonly keepAliveInitialDelayMs?: number;
  /** Node.js 24.19+ maps this to TCP_KEEPINTVL where supported. */
  readonly keepAliveIntervalMs?: number;
  /** Node.js 24.19+ maps this to TCP_KEEPCNT where supported. */
  readonly keepAliveProbeCount?: number;
  readonly noDelay?: boolean;
  readonly localAddress?: string;
  readonly localPort?: number;
  readonly tls?: RouterOSTlsOptions;
}

export interface RouterOSTransportEvents {
  readonly connected: { readonly at: number };
  readonly disconnected: { readonly at: number; readonly error?: unknown };
  readonly data: { readonly chunk: Buffer; readonly at: number };
  /** Safe non-special event name; unlike EventEmitter's reserved `error`. */
  readonly fault: { readonly error: unknown; readonly at: number };
}

export interface RouterOSTransport {
  readonly connected: boolean;
  readonly kind: RouterOSTransportKind;
  connect(signal?: AbortSignal): Promise<void>;
  write(data: Uint8Array, signal?: AbortSignal): Promise<void>;
  close(): Promise<void>;
  on<E extends keyof RouterOSTransportEvents>(
    event: E,
    listener: (payload: RouterOSTransportEvents[E]) => void,
  ): this;
  off<E extends keyof RouterOSTransportEvents>(
    event: E,
    listener: (payload: RouterOSTransportEvents[E]) => void,
  ): this;
}
