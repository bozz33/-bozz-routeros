import type { RouterOSCommandResult, RouterOSReply } from '../protocol/reply.js';

export type RouterOSPrimitive = string | number | boolean | null | undefined;
export type RouterOSInput = Readonly<Record<string, RouterOSPrimitive>>;

export interface RouterOSCommandOptions {
  readonly attributes?: RouterOSInput;
  readonly apiAttributes?: RouterOSInput;
  readonly queries?: readonly string[];
  readonly tag?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly mutation?: boolean;
}

export interface RouterOSStream extends AsyncIterable<RouterOSReply> {
  readonly tag: string;
  readonly closed: boolean;
  cancel(signal?: AbortSignal): Promise<void>;
}

export interface RouterOSClient {
  readonly connected: boolean;
  connect(signal?: AbortSignal): Promise<void>;
  login(username: string, password: string, signal?: AbortSignal): Promise<void>;
  execute(command: string, options?: RouterOSCommandOptions): Promise<RouterOSCommandResult>;
  print(command: string, options?: RouterOSCommandOptions): Promise<readonly Record<string, string>[]>;
  listen(command: string, options?: RouterOSCommandOptions): Promise<RouterOSStream>;
  close(): Promise<void>;
}
