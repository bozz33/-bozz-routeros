import { RouterOSProtocolError } from '../errors.js';

export const MAX_ROUTEROS_WORD_LENGTH = 0xffff_ffff;

export interface DecodedLength {
  readonly length: number;
  readonly bytesRead: number;
}

/**
 * Encode a RouterOS API word length using MikroTik's binary API framing.
 *
 * This implementation is adapted from the Apache-2.0 SourceRegistry
 * `mikrotik-client` codec and hardened with an explicit unsigned 32-bit cap.
 */
export function encodeLength(length: number): Buffer {
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_ROUTEROS_WORD_LENGTH) {
    throw new RangeError(`Invalid RouterOS word length: ${length}`);
  }

  if (length < 0x80) {
    return Buffer.from([length]);
  }

  if (length < 0x4000) {
    const value = length | 0x8000;
    return Buffer.from([(value >>> 8) & 0xff, value & 0xff]);
  }

  if (length < 0x20_0000) {
    const value = length | 0xc0_0000;
    return Buffer.from([
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ]);
  }

  if (length < 0x1000_0000) {
    const value = (length | 0xe000_0000) >>> 0;
    const encoded = Buffer.allocUnsafe(4);
    encoded.writeUInt32BE(value, 0);
    return encoded;
  }

  const encoded = Buffer.allocUnsafe(5);
  encoded[0] = 0xf0;
  encoded.writeUInt32BE(length, 1);
  return encoded;
}

/**
 * Decode a RouterOS API word length. Returns `undefined` when the current
 * buffer does not yet contain the complete length prefix.
 */
export function decodeLength(buffer: Uint8Array, offset = 0): DecodedLength | undefined {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError(`Invalid RouterOS decode offset: ${offset}`);
  }

  if (offset >= buffer.byteLength) {
    return undefined;
  }

  const first = buffer[offset];
  if (first === undefined) {
    return undefined;
  }

  if (first < 0x80) {
    return { length: first, bytesRead: 1 };
  }

  if (first < 0xc0) {
    if (offset + 2 > buffer.byteLength) return undefined;
    const second = buffer[offset + 1];
    if (second === undefined) return undefined;
    return {
      length: ((first << 8) | second) & 0x3fff,
      bytesRead: 2,
    };
  }

  if (first < 0xe0) {
    if (offset + 3 > buffer.byteLength) return undefined;
    const second = buffer[offset + 1];
    const third = buffer[offset + 2];
    if (second === undefined || third === undefined) return undefined;
    return {
      length: ((first << 16) | (second << 8) | third) & 0x1f_ffff,
      bytesRead: 3,
    };
  }

  if (first < 0xf0) {
    if (offset + 4 > buffer.byteLength) return undefined;
    const view = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    return {
      length: view.readUInt32BE(offset) & 0x0fff_ffff,
      bytesRead: 4,
    };
  }

  if (first === 0xf0) {
    if (offset + 5 > buffer.byteLength) return undefined;
    const view = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    return {
      length: view.readUInt32BE(offset + 1),
      bytesRead: 5,
    };
  }

  throw new RouterOSProtocolError(
    `Reserved RouterOS control byte encountered: 0x${first.toString(16).padStart(2, '0')}`,
  );
}
