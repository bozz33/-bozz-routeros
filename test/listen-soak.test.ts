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

test('long-running listen consumes 20k sustained events and cancels cleanly', async () => {
  const totalEvents = 20_000;
  const batchSize = 16;
  const batchIntervalMs = 1;
  let activeTimer: NodeJS.Timeout | undefined;

  const server = net.createServer((socket) => {
    const decoder = new SentenceDecoder();
    let listenTag: string | undefined;
    let sequence = 0;
    let cancelled = false;

    const schedulePump = () => {
      if (socket.destroyed || cancelled || !listenTag || sequence >= totalEvents) return;
      activeTimer = setTimeout(pump, batchIntervalMs);
    };

    const pump = () => {
      if (socket.destroyed || cancelled || !listenTag) return;

      const batch: Buffer[] = [];
      for (let index = 0; index < batchSize && sequence < totalEvents; index += 1) {
        batch.push(
          encodeSentence([
            '!re',
            '=.id=*1',
            `=sequence=${sequence}`,
            '=name=ether1',
            `.tag=${listenTag}`,
          ]),
        );
        sequence += 1;
      }

      if (batch.length === 0) return;

      // This soak test models a sustained event stream, not an unbounded burst.
      // The dedicated overflow tests intentionally exercise queue exhaustion.
      // Respect socket backpressure and also yield between batches so the
      // consumer gets event-loop turns to drain its bounded queue.
      const writable = socket.write(Buffer.concat(batch));
      if (sequence >= totalEvents) return;
      if (writable) {
        schedulePump();
      } else {
        socket.once('drain', schedulePump);
      }
    };

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
          schedulePump();
          continue;
        }

        if (command === '/cancel') {
          const target = value(sentence, '=', 'tag');
          if (!target || target !== listenTag) continue;
          cancelled = true;
          if (activeTimer) clearTimeout(activeTimer);
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
  const client = new RouterOSClient({
    host: '127.0.0.1',
    port,
    username: 'admin',
    streamMaxQueuedReplies: 512,
    commandTimeoutMs: 5_000,
  });

  try {
    const stream = await client.listen('/interface');
    for (let expected = 0; expected < totalEvents; expected += 1) {
      const reply = await stream.nextReply(2_000);
      assert.equal(reply?.type, 're');
      assert.equal(reply?.attributes.sequence, String(expected));
    }

    await stream.cancel();
    assert.equal(stream.closed, true);
    assert.equal(client.pendingTags, 0);

    // RouterOS cancel normally reports `!trap ... interrupted` on the target
    // listener before the listener's terminal `!done`. The stream deliberately
    // preserves that reply for consumers, so drain it before asserting that
    // the bounded queue returned to baseline.
    const interrupted = await stream.nextReply();
    assert.equal(interrupted?.type, 'trap');
    assert.equal(interrupted?.attributes.message, 'interrupted');
    assert.equal(await stream.nextReply(), undefined);
    assert.equal(stream.queuedReplies, 0);
  } finally {
    await client.close();
    await closeServer(server);
  }
});
