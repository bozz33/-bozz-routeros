import { RouterOSProtocolError } from '../errors.js';
import type {
  RouterOSAttributes,
  RouterOSReply,
  RouterOSReplyType,
} from './reply.js';

const REPLY_TYPES: ReadonlySet<string> = new Set(['re', 'empty', 'trap', 'done', 'fatal']);

function parseKeyValueWord(word: string): readonly [string, string] {
  const separator = word.indexOf('=', 1);
  if (separator === -1) {
    return [word.slice(1), ''];
  }
  return [word.slice(1, separator), word.slice(separator + 1)];
}

/** Parse one complete RouterOS reply sentence into a typed reply. */
export function parseReply(words: readonly string[]): RouterOSReply {
  const head = words[0];
  if (!head) {
    throw new RouterOSProtocolError('Received an empty RouterOS reply sentence');
  }

  if (!head.startsWith('!')) {
    throw new RouterOSProtocolError(`Unsupported RouterOS reply head: ${head}`);
  }

  const type = head.slice(1);
  if (!REPLY_TYPES.has(type)) {
    throw new RouterOSProtocolError(`Unsupported RouterOS reply type: ${head}`);
  }

  const attributes: Record<string, string> = {};
  const apiAttributes: Record<string, string> = {};

  for (const word of words.slice(1)) {
    if (word.startsWith('=')) {
      const [key, value] = parseKeyValueWord(word);
      attributes[key] = value;
      continue;
    }

    if (word.startsWith('.')) {
      const [key, value] = parseKeyValueWord(word);
      apiAttributes[key] = value;
    }
  }

  const tag = apiAttributes.tag;
  const common = {
    attributes: attributes as RouterOSAttributes,
    apiAttributes: apiAttributes as RouterOSAttributes,
    raw: [...words],
    ...(tag === undefined ? {} : { tag }),
  };

  return {
    ...common,
    type: type as RouterOSReplyType,
  } as RouterOSReply;
}
