import { encodeSentence } from '../codec/sentence.js';
import type { RouterOSInput, RouterOSPrimitive, RouterOSScalar } from './types.js';

export function normalizeCommand(command: string): string {
  const trimmed = command.trim();
  if (trimmed === '') throw new TypeError('RouterOS command must not be empty');
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function normalizeScalar(value: RouterOSScalar): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function isScalarArray(value: RouterOSPrimitive): value is readonly RouterOSScalar[] {
  return Array.isArray(value);
}

function normalizeValue(value: RouterOSPrimitive): string | undefined {
  if (isScalarArray(value)) {
    return value.map((item) => normalizeScalar(item) ?? '').join(',');
  }
  return normalizeScalar(value);
}

export function encodeInputWords(prefix: '=' | '.', input?: RouterOSInput): string[] {
  if (!input) return [];
  const words: string[] = [];
  for (const [key, rawValue] of Object.entries(input)) {
    if (key === '') throw new TypeError('RouterOS attribute name must not be empty');
    const value = normalizeValue(rawValue);
    if (value === undefined) continue;
    words.push(`${prefix}${key}=${value}`);
  }
  return words;
}

export function buildCommandSentence(
  command: string,
  tag: string,
  attributes?: RouterOSInput,
  apiAttributes?: RouterOSInput,
  queries: readonly string[] = [],
): Buffer {
  if (tag === '') throw new TypeError('RouterOS tag must not be empty');
  for (const query of queries) {
    if (!query.startsWith('?')) {
      throw new TypeError(`RouterOS query words must start with ?: ${query}`);
    }
  }

  // Preserve query order: MikroTik documents query-word ordering as significant.
  return encodeSentence([
    normalizeCommand(command),
    ...encodeInputWords('=', attributes),
    ...queries,
    ...encodeInputWords('.', { ...apiAttributes, tag }),
  ]);
}
