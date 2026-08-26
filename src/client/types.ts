import type { RouterOSCommandResult, RouterOSReply } from '../protocol/reply.js';

export type RouterOSScalar = string | number | boolean | null | undefined;
export type RouterOSPrimitive = RouterOSScalar | readonly RouterOSScalar[];
export type RouterOSInput = Readonly<Record<string, RouterOSPrimitive>>;

export type RouterOSMutationKind = 'auto' | 'read' | 'write' | 'control';
export type RouterOSStreamOverflowPolicy = 'error' | 'drop-oldest';

export interface RouterOSCommandOptions {
  readonly attributes?: RouterOSInput;
  readonly apiAttributes?: RouterOSInput;
  readonly queries?: readonly string[];
  readonly tag?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /**
   * Controls failure semantics after command bytes may have reached RouterOS.
   * `auto` is conservative: known read commands are reads, protocol commands
   * are control operations, and unknown commands are treated as writes.
   */
  readonly kind?: RouterOSMutationKind;
}

export interface RouterOSListenOptions extends RouterOSCommandOptions {
  readonly maxQueuedReplies?: number;
  readonly overflowPolicy?: RouterOSStreamOverflowPolicy;
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
