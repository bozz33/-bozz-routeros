import type { RouterOSFatalReply, RouterOSTrapReply } from './protocol/reply.js';

export class RouterOSError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class RouterOSProtocolError extends RouterOSError {}
export class RouterOSConnectionError extends RouterOSError {}
export class RouterOSTimeoutError extends RouterOSError {}
export class RouterOSCancelledError extends RouterOSError {}
export class RouterOSAuthenticationError extends RouterOSError {}

export class RouterOSTrapError extends RouterOSError {
  public constructor(
    message: string,
    public readonly replies: readonly RouterOSTrapReply[],
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class RouterOSFatalError extends RouterOSError {
  public constructor(
    message: string,
    public readonly reply: RouterOSFatalReply,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * A write may have reached RouterOS even though the transport failed before
 * the terminal acknowledgement was observed. Callers must reconcile the
 * desired state before deciding whether a retry is safe.
 */
export class RouterOSAmbiguousWriteError extends RouterOSError {
  public constructor(
    message: string,
    public readonly command: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
