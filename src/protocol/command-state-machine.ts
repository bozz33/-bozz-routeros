import { RouterOSFatalError, RouterOSProtocolError, RouterOSTrapError } from '../errors.js';
import type {
  RouterOSCommandResult,
  RouterOSDoneReply,
  RouterOSReply,
  RouterOSTrapReply,
} from './reply.js';

export type CommandState = 'open' | 'completed' | 'fatal';

/**
 * Strict RouterOS command lifecycle.
 *
 * `!empty` and `!trap` are observations, not terminal states. The command tag
 * remains registered until the matching `!done` is received. `!fatal` is the
 * only terminal reply that closes without a subsequent `!done`.
 */
export class CommandStateMachine {
  readonly #records: Record<string, string>[] = [];
  readonly #traps: RouterOSTrapReply[] = [];
  #empty = false;
  #state: CommandState = 'open';

  public constructor(public readonly tag: string) {}

  public get state(): CommandState {
    return this.#state;
  }

  public accept(reply: RouterOSReply): RouterOSCommandResult | undefined {
    if (this.#state !== 'open') {
      throw new RouterOSProtocolError(`Reply received for terminal tag ${this.tag}`);
    }

    if (reply.tag !== undefined && reply.tag !== this.tag) {
      throw new RouterOSProtocolError(
        `Reply tag mismatch: expected ${this.tag}, received ${reply.tag}`,
      );
    }

    switch (reply.type) {
      case 're':
        this.#records.push({ ...reply.attributes });
        return undefined;

      case 'empty':
        this.#empty = true;
        return undefined;

      case 'trap':
        this.#traps.push(reply);
        return undefined;

      case 'fatal':
        this.#state = 'fatal';
        throw new RouterOSFatalError(
          reply.attributes.message ?? `RouterOS fatal reply for tag ${this.tag}`,
          reply,
        );

      case 'done':
        return this.#complete(reply);
    }
  }

  #complete(done: RouterOSDoneReply): RouterOSCommandResult {
    this.#state = 'completed';

    if (this.#traps.length > 0) {
      const message = this.#traps[0]?.attributes.message ?? `RouterOS trap for tag ${this.tag}`;
      throw new RouterOSTrapError(message, [...this.#traps]);
    }

    return {
      tag: this.tag,
      records: [...this.#records],
      empty: this.#empty,
      traps: [],
      done,
    };
  }
}
