export type RouterOSQueryValue = string | number | boolean | null;

function normalizeQueryValue(value: RouterOSQueryValue): string {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function validatePropertyName(name: string): string {
  if (name.length === 0) throw new TypeError('RouterOS query property name must not be empty');
  if (name.includes('?') || name.includes('=') || name.includes('\0')) {
    throw new TypeError(`Invalid RouterOS query property name: ${name}`);
  }
  return name;
}

function validateRawWord(word: string): string {
  if (!word.startsWith('?')) {
    throw new TypeError(`RouterOS query words must start with ?: ${word}`);
  }
  if (word.includes('\0')) {
    throw new TypeError('RouterOS query word must not contain NUL');
  }
  return word;
}

function validateOperations(operations: string): string {
  if (operations.length === 0) {
    throw new TypeError('RouterOS query operation sequence must not be empty');
  }
  if (!/^[0-9!&|.]+$/.test(operations)) {
    throw new TypeError(`Invalid RouterOS query operation sequence: ${operations}`);
  }
  return operations;
}

/**
 * Ordered RouterOS API query-word builder.
 *
 * RouterOS evaluates query words from left to right using a boolean stack, so
 * this builder intentionally preserves insertion order and does not attempt to
 * reorder or optimize expressions.
 */
export class RouterOSQueryBuilder {
  readonly #words: string[] = [];

  public get length(): number {
    return this.#words.length;
  }

  public has(name: string): this {
    this.#words.push(`?${validatePropertyName(name)}`);
    return this;
  }

  public missing(name: string): this {
    this.#words.push(`?-${validatePropertyName(name)}`);
    return this;
  }

  public equals(name: string, value: RouterOSQueryValue): this {
    this.#words.push(`?${validatePropertyName(name)}=${normalizeQueryValue(value)}`);
    return this;
  }

  public lessThan(name: string, value: RouterOSQueryValue): this {
    this.#words.push(`?<${validatePropertyName(name)}=${normalizeQueryValue(value)}`);
    return this;
  }

  public greaterThan(name: string, value: RouterOSQueryValue): this {
    this.#words.push(`?>${validatePropertyName(name)}=${normalizeQueryValue(value)}`);
    return this;
  }

  /** Apply RouterOS boolean-stack operations exactly as documented. */
  public operations(operations: string): this {
    this.#words.push(`?#${validateOperations(operations)}`);
    return this;
  }

  public and(): this {
    return this.operations('&');
  }

  public or(): this {
    return this.operations('|');
  }

  public not(): this {
    return this.operations('!');
  }

  /** Escape hatch for future RouterOS query grammar additions. */
  public raw(word: string): this {
    this.#words.push(validateRawWord(word));
    return this;
  }

  public clear(): this {
    this.#words.length = 0;
    return this;
  }

  /** Return a detached immutable snapshot suitable for `execute/print`. */
  public toWords(): readonly string[] {
    return Object.freeze([...this.#words]);
  }
}

export function routerOSQuery(): RouterOSQueryBuilder {
  return new RouterOSQueryBuilder();
}
