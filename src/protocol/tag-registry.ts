import { RouterOSProtocolError } from '../errors.js';

export type RouterOSTagKind = 'command' | 'listen' | 'cancel';

export interface RouterOSTagEntry<T = unknown> {
  readonly tag: string;
  readonly kind: RouterOSTagKind;
  readonly createdAt: number;
  readonly context: T;
}

export interface RouterOSOrphanReply {
  readonly tag: string;
  readonly observedAt: number;
  readonly raw: readonly string[];
}

export class TagRegistry {
  readonly #entries = new Map<string, RouterOSTagEntry>();
  #nextId = 1n;

  public allocate(kind: RouterOSTagKind, context: unknown, prefix = 'B'): RouterOSTagEntry {
    let tag: string;
    do {
      tag = `${prefix}${this.#nextId++}`;
    } while (this.#entries.has(tag));

    const entry: RouterOSTagEntry = {
      tag,
      kind,
      createdAt: Date.now(),
      context,
    };

    this.#entries.set(tag, entry);
    return entry;
  }

  public register<T>(entry: RouterOSTagEntry<T>): void {
    if (this.#entries.has(entry.tag)) {
      throw new RouterOSProtocolError(`RouterOS tag already registered: ${entry.tag}`);
    }
    this.#entries.set(entry.tag, entry);
  }

  public get<T = unknown>(tag: string): RouterOSTagEntry<T> | undefined {
    return this.#entries.get(tag) as RouterOSTagEntry<T> | undefined;
  }

  public release<T = unknown>(tag: string): RouterOSTagEntry<T> | undefined {
    const entry = this.#entries.get(tag) as RouterOSTagEntry<T> | undefined;
    this.#entries.delete(tag);
    return entry;
  }

  public has(tag: string): boolean {
    return this.#entries.has(tag);
  }

  public get size(): number {
    return this.#entries.size;
  }

  public clear(): void {
    this.#entries.clear();
  }
}
