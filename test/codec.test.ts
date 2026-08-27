import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeLength, encodeLength } from '../src/codec/length.js';
import { encodeSentence, SentenceDecoder } from '../src/codec/sentence.js';
import { parseReply } from '../src/protocol/reply-parser.js';
import { RouterOSProtocolError } from '../src/errors.js';

const LENGTH_BOUNDARIES = [
  0,
  1,
  0x7f,
  0x80,
  0x3fff,
  0x4000,
  0x1f_ffff,
  0x20_0000,
  0x0fff_ffff,
  0x1000_0000,
  0xffff_ffff,
];

test('RouterOS word-length codec round-trips official boundary ranges', () => {
  for (const length of LENGTH_BOUNDARIES) {
    const encoded = encodeLength(length);
    const decoded = decodeLength(encoded);
    assert.ok(decoded);
    assert.equal(decoded.length, length);
    assert.equal(decoded.bytesRead, encoded.length);
  }
});

test('SentenceDecoder reconstructs sentences across arbitrary TCP fragmentation', () => {
  const frame = encodeSentence([
    '!re',
    '=.id=*1',
    '=name=ether1',
    '=comment=value=with=equals',
    '.tag=L42',
  ]);
  const decoder = new SentenceDecoder();
  const sentences: string[][] = [];

  for (const byte of frame) {
    sentences.push(...decoder.push(Buffer.from([byte])));
  }

  assert.deepEqual(sentences, [[
    '!re',
    '=.id=*1',
    '=name=ether1',
    '=comment=value=with=equals',
    '.tag=L42',
  ]]);
  assert.equal(decoder.bufferedBytes, 0);
});

test('reply parser preserves equals signs and separates API tag attributes', () => {
  const reply = parseReply([
    '!re',
    '=comment=a=b=c',
    '=.dead=yes',
    '.tag=U7',
  ]);

  assert.equal(reply.type, 're');
  assert.equal(reply.tag, 'U7');
  assert.equal(reply.attributes.comment, 'a=b=c');
  assert.equal(reply.attributes['.dead'], 'yes');
  assert.equal(reply.apiAttributes.tag, 'U7');
});

test('SentenceDecoder enforces configured word resource limits', () => {
  const decoder = new SentenceDecoder({ maxWordBytes: 3 });
  assert.throws(
    () => decoder.push(encodeSentence(['abcd'])),
    RouterOSProtocolError,
  );
});

test('reserved RouterOS control bytes are rejected', () => {
  assert.throws(
    () => decodeLength(Buffer.from([0xf8])),
    RouterOSProtocolError,
  );
});
