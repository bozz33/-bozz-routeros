import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { RouterOSClient, SentenceDecoder, encodeSentence } from '../src/index.js';

function value(words: readonly string[], prefix: '=' | '.', key: string): string | undefined {
  const marker = `${prefix}${key}=`;
  return words.find((word) => word.startsWith(marker))?.slice(marker.length);
}

async function listenServer(server: net.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind mock RouterOS');
  return address.port;
}

async function closeServer(server: net.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('10k command lifecycles release every tag without cross-talk', async () => {
  const total = 10_000;
  const server = net.createServer((socket) => {
    const decoder = new SentenceDecoder();
    socket.on('data', (chunk) => {
      for (const sentence of decoder.push(chunk)) {
        const command = sentence[0];
        const tag = value(sentence, '.', 'tag');
        if (!command || !tag) continue;
        if (command === '/login') {
          socket.write(encodeSentence(['!done', `.tag=${tag}`]));
          continue;
        }
        if (command === '/system/resource/print') {
          const sequence = value(sentence, '=', 'sequence') ?? '-1';
          socket.write(Buffer.concat([
            encodeSentence(['!re', `=sequence=${sequence}`, `.tag=${tag}`]),
            encodeSentence(['!done', `.tag=${tag}`]),
          ]));
        }
      }
    });
  });

  const port = await listenServer(server);
  const client = new RouterOSClient({
    host: '127.0.0.1',
    port,
    username: 'admin',
    commandTimeoutMs: 5_000,
  });

  try {
    const batchSize = 250;
    for (let offset = 0; offset < total; offset += batchSize) {
      const count = Math.min(batchSize, total - offset);
      const results = await Promise.all(
        Array.from({ length: count }, (_, index) => {
          const sequence = offset + index;
          return client.execute('/system/resource/print', {
            attributes: { sequence },
            kind: 'read',
          });
        }),
      );

      for (let index = 0; index < results.length; index += 1) {
        assert.equal(results[index]?.records[0]?.sequence, String(offset + index));
      }
      assert.equal(client.pendingTags, 0, `tag leak after batch ending at ${offset + count}`);
    }
  } finally {
    await client.close();
    await closeServer(server);
  }
});

test('1k listen/cancel lifecycles release listener and cancel tags', async () => {
  const cycles = 1_000;
  const server = net.createServer((socket) => {
    const decoder = new SentenceDecoder();
    socket.on('data', (chunk) => {
      for (const sentence of decoder.push(chunk)) {
        const command = sentence[0];
        const tag = value(sentence, '.', 'tag');
        if (!command || !tag) continue;
        if (command === '/login') {
          socket.write(encodeSentence(['!done', `.tag=${tag}`]));
          continue;
        }
        if (command === '/interface/listen') {
          socket.write(encodeSentence(['!re', '=.id=*1', '=name=ether1', `.tag=${tag}`]));
          continue;
        }
        if (command === '/cancel') {
          const target = value(sentence, '=', 'tag');
          if (!target) continue;
          socket.write(Buffer.concat([
            encodeSentence(['!trap', '=category=2', '=message=interrupted', `.tag=${target}`]),
            encodeSentence(['!done', `.tag=${tag}`]),
            encodeSentence(['!done', `.tag=${target}`]),
          ]));
        }
      }
    });
  });

  const port = await listenServer(server);
  const client = new RouterOSClient({ host: '127.0.0.1', port, username: 'admin' });

  try {
    for (let index = 0; index < cycles; index += 1) {
      const stream = await client.listen('/interface', { maxQueuedReplies: 4 });
      const first = await stream.nextReply(500);
      assert.equal(first?.type, 're');
      await stream.cancel();
      assert.equal(stream.closed, true);
      assert.equal(client.pendingTags, 0, `tag leak after listen cycle ${index}`);
    }
  } finally {
    await client.close();
    await closeServer(server);
  }
});
