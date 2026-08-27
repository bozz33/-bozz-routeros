export type RouterOSAttributes = Readonly<Record<string, string>>;

export type RouterOSReplyType = 're' | 'empty' | 'trap' | 'done' | 'fatal';

interface RouterOSReplyBase {
  readonly type: RouterOSReplyType;
  readonly tag?: string;
  readonly attributes: RouterOSAttributes;
  readonly apiAttributes: RouterOSAttributes;
  readonly raw: readonly string[];
}

export interface RouterOSReReply extends RouterOSReplyBase {
  readonly type: 're';
}

export interface RouterOSEmptyReply extends RouterOSReplyBase {
  readonly type: 'empty';
}

export interface RouterOSTrapReply extends RouterOSReplyBase {
  readonly type: 'trap';
}

export interface RouterOSDoneReply extends RouterOSReplyBase {
  readonly type: 'done';
}

export interface RouterOSFatalReply extends RouterOSReplyBase {
  readonly type: 'fatal';
}

export type RouterOSReply =
  | RouterOSReReply
  | RouterOSEmptyReply
  | RouterOSTrapReply
  | RouterOSDoneReply
  | RouterOSFatalReply;

export interface RouterOSCommandResult {
  readonly tag: string;
  readonly records: readonly RouterOSAttributes[];
  readonly empty: boolean;
  readonly traps: readonly RouterOSTrapReply[];
  readonly done: RouterOSDoneReply;
}

export function isTerminalReply(reply: RouterOSReply): reply is RouterOSDoneReply | RouterOSFatalReply {
  return reply.type === 'done' || reply.type === 'fatal';
}
