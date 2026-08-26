import { RouterOSProtocolError } from '../errors.js';
import { decodeLength, encodeLength } from './length.js';

export interface SentenceDecoderOptions {
  /** Maximum decoded RouterOS word size accepted from the peer. */
  readonly maxWordBytes?: number;
  /** Maximum unread buffered bytes retained between socket chunks. */
  readonly maxBufferedBytes?: number;
  /** Maximum words accepted in one RouterOS sentence. */
  readonly maxWordsPerSentence?: number;
}

const DEFAULT_MAX_WORD_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_WORDS_PER_SENTENCE = 16_384;

export function encodeWord(word: string): Buffer {
  const content = Buffer.from(word, 'utf8');
  return Buffer.concat([encodeLength(content.length), content]);
}

export function encodeSentence(words: readonly string[]): Buffer {
  const parts = words.map((word) => encodeWord(word));
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

/**
 * Incremental RouterOS sentence decoder.
 *
 * Based on the SourceRegistry streaming decoder, with explicit resource caps,
 * empty-sentence suppression (as documented by MikroTik), and buffer detaching
 * so a small unread tail does not retain a large historical TCP chunk.
 */
export class SentenceDecoder {
  readonly #maxWordBytes: number;
  readonly #maxBufferedBytes: number;
  readonly #maxWordsPerSentence: number;

  #buffer = Buffer.alloc(0);
  #currentWords: string[] = [];

  public constructor(options: SentenceDecoderOptions = {}) {
    this.#maxWordBytes = options.maxWordBytes ?? DEFAULT_MAX_WORD_BYTES;
    this.#maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
    this.#maxWordsPerSentence = options.maxWordsPerSentence ?? DEFAULT_MAX_WORDS_PER_SENTENCE;

    for (const [name, value] of [
      ['maxWordBytes', this.#maxWordBytes],
      ['maxBufferedBytes', this.#maxBufferedBytes],
      ['maxWordsPerSentence', this.#maxWordsPerSentence],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`);
      }
    }
  }

  public get bufferedBytes(): number {
    return this.#buffer.length;
  }

  public push(chunk: Uint8Array): string[][] {
    if (chunk.byteLength === 0) {
      return [];
    }

    const incoming = Buffer.from(chunk);
    this.#buffer =
      this.#buffer.length === 0 ? incoming : Buffer.concat([this.#buffer, incoming]);

    if (this.#buffer.length > this.#maxBufferedBytes) {
      throw new RouterOSProtocolError(
        `RouterOS decoder buffer exceeded ${this.#maxBufferedBytes} bytes`,
      );
    }

    const sentences: string[][] = [];
    let offset = 0;

    while (offset < this.#buffer.length) {
      const decoded = decodeLength(this.#buffer, offset);
      if (!decoded) break;

      if (decoded.length > this.#maxWordBytes) {
        throw new RouterOSProtocolError(
          `RouterOS word length ${decoded.length} exceeds configured limit ${this.#maxWordBytes}`,
        );
      }

      const wordStart = offset + decoded.bytesRead;
      const wordEnd = wordStart + decoded.length;
      if (wordEnd > this.#buffer.length) break;

      offset = wordEnd;

      if (decoded.length === 0) {
        // MikroTik documents empty sentences as ignored. Do the same locally.
        if (this.#currentWords.length > 0) {
          sentences.push(this.#currentWords);
          this.#currentWords = [];
        }
        continue;
      }

      if (this.#currentWords.length >= this.#maxWordsPerSentence) {
        throw new RouterOSProtocolError(
          `RouterOS sentence exceeded ${this.#maxWordsPerSentence} words`,
        );
      }

      this.#currentWords.push(this.#buffer.subarray(wordStart, wordEnd).toString('utf8'));
    }

    this.#buffer = offset === 0 ? this.#buffer : Buffer.from(this.#buffer.subarray(offset));
    return sentences;
  }

  public reset(): void {
    this.#buffer = Buffer.alloc(0);
    this.#currentWords = [];
  }
}
