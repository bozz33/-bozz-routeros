import type { Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';

export type RouterOSSocket = Socket | TLSSocket;

export type RouterOSTransportKind = 'tcp' | 'tls';

export interface RouterOSTlsOptions {
  readonly servername?: string;
  readonly ca?: string | Buffer | readonly (string | Buffer)[];
  readonly cert?: string | Buffer;
  readonly key?: string | Buffer;
  readonly rejectUnauthorized?: boolean;
}

export interface RouterOSTransportOptions {
  readonly host: string;
  readonly port?: number;
  readonly kind?: RouterOSTransportKind;
  readonly connectTimeoutMs?: number;
  readonly keepAlive?: boolean;
  readonly keepAliveInitialDelayMs?: number;
  readonly noDelay?: boolean;
  readonly tls?: RouterOSTlsOptions;
}

export interface RouterOSTransportEvents {
  readonly connected: { readonly at: number };
  readonly disconnected: { readonly at: number; readonly error?: unknown };
  readonly data: { readonly chunk: Buffer; readonly at: number };
  readonly error: { readonly error: unknown; readonly at: number };
}

export interface RouterOSTransport {
  readonly connected: boolean;
  connect(signal?: AbortSignal): Promise<void>;
  write(data: Uint8Array, signal?: AbortSignal): Promise<void>;
  close(): Promise<void>;
}
