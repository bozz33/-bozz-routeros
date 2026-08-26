import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import {
  RouterOSCancelledError,
  RouterOSClient,
  RouterOSTimeoutError,
  SentenceDecoder,
  encodeSentence,
} from '../src/index.js';

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

test('aborted caller wait cannot suppress RouterOS /cancel cleanup', async () => {
  let cancelReceived = 0;
  const server = net.createServer((socket) => {
    const decoder = new SentenceDecoder();
    let listenTag: string | undefined;

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
          listenTag = tag;
          socket.write(encodeSentence(['!re', '=.id=*1', '=name=ether1', `.tag=${tag}`]));
          continue;
        }
        if (command === '/cancel' && value(sentence, '=', 'tag') === listenTag) {
          cancelReceived += 1;
          setTimeout(() => {
            if (socket.destroyed || !listenTag) return;
            socket.write(Buffer.concat([
              encodeSentence(['!trap', '=category=2', '=message=interrupted', `.tag=${listenTag}`]),
              encodeSentence(['!done', `.tag=${tag}`]),
              encodeSentence(['!done', `.tag=${listenTag}`]),
            ]));
          }, 20);
        }
      }
    });
  });

  const port = await listenServer(server);
  const client = new RouterOSClient({
    host: '127.0.0.1',
    port,
    username: 'admin',
    cancelTimeoutMs: 500,
  });

  try {
    const stream = await client.listen('/interface');
    await stream.nextReply(500);

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(stream.cancel(controller.signal), RouterOSCancelledError);

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(cancelReceived, 1);
    assert.equal(stream.closed, true);
    assert.equal(client.pendingTags, 0);
    assert.equal(client.connected, true, 'successful background cleanup should preserve the socket');
  } finally {
    await client.close();
    await closeServer(server);
  }
});

test('incomplete /cancel lifecycle quarantines the connection after hard timeout', async () => {
  let cancelReceived = 0;
  const server = net.createServer((socket) => {
    const decoder = new SentenceDecoder();
    let listenTag: string | undefined;

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
          listenTag = tag;
          socket.write(encodeSentence(['!re', '=.id=*1', '=name=ether1', `.tag=${tag}`]));
          continue;
        }
        if (command === '/cancel' && value(sentence, '=', 'tag') === listenTag) {
          cancelReceived += 1;
          // Deliberately never send !done for either tag. The SDK must treat
          // remote listener state as unknowable and close the API connection.
        }
      }
    });
  });

  const port = await listenServer(server);
  const client = new RouterOSClient({
    host: '127.0.0.1',
    port,
    username: 'admin',
    cancelTimeoutMs: 30,
  });

  try {
    const stream = await client.listen('/interface');
    await stream.nextReply(500);

    await assert.rejects(stream.cancel(), RouterOSTimeoutError);
    await new Promise((resolve) => setTimeout(resolve, 40));

    assert.equal(cancelReceived, 1);
    assert.equal(stream.closed, true);
    assert.equal(client.pendingTags, 0);
    assert.equal(client.connected, false);
  } finally {
    await client.close();
    await closeServer(server);
  }
});
