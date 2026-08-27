import type { RouterOSCommandResult, RouterOSReply } from '../protocol/reply.js';

export type RouterOSScalar = string | number | boolean | null | undefined;
export type RouterOSPrimitive = RouterOSScalar | readonly RouterOSScalar[];
export type RouterOSInput = Readonly<Record<string, RouterOSPrimitive>>;

export type RouterOSMutationKind = 'auto' | 'read' | 'write' | 'control';
export type RouterOSStreamOverflowPolicy = 'error' | 'drop-oldest';

export interface RouterOSCommandOptions {
  readonly attributes?: RouterOSInput | undefined;
  readonly apiAttributes?: RouterOSInput | undefined;
  readonly queries?: readonly string[] | undefined;
  readonly tag?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  /**
   * Controls failure semantics after command bytes may have reached RouterOS.
   * `auto` is conservative: known read commands are reads, protocol commands
   * are control operations, and unknown commands are treated as writes.
   */
  readonly kind?: RouterOSMutationKind | undefined;
}

export interface RouterOSListenOptions extends RouterOSCommandOptions {
  readonly maxQueuedReplies?: number | undefined;
  readonly overflowPolicy?: RouterOSStreamOverflowPolicy | undefined;
}

export interface RouterOSStream extends AsyncIterable<RouterOSReply> {
  readonly tag: string;
  readonly closed: boolean;
  readonly queuedReplies: number;
  nextReply(timeoutMs?: number, signal?: AbortSignal): Promise<RouterOSReply | undefined>;
  cancel(signal?: AbortSignal): Promise<void>;
}

export interface RouterOSClientLike {
  readonly connected: boolean;
  connect(signal?: AbortSignal): Promise<void>;
  login(username: string, password: string, signal?: AbortSignal): Promise<void>;
  execute(command: string, options?: RouterOSCommandOptions): Promise<RouterOSCommandResult>;
  print(command: string, options?: RouterOSCommandOptions): Promise<readonly Record<string, string>[]>;
  listen(command: string, options?: RouterOSListenOptions): Promise<RouterOSStream>;
  close(): Promise<void>;
}
