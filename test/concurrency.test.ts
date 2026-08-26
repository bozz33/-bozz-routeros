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

test('hundreds of concurrent tagged commands resolve correctly despite out-of-order replies', async () => {
  const commandCount = 256;
  let loginCount = 0;

  const server = net.createServer((socket) => {
    const decoder = new SentenceDecoder();
    socket.on('data', (chunk) => {
      for (const sentence of decoder.push(chunk)) {
        const command = sentence[0];
        const tag = value(sentence, '.', 'tag');
        if (!command || !tag) continue;

        if (command === '/login') {
          loginCount += 1;
          socket.write(encodeSentence(['!done', `.tag=${tag}`]));
          continue;
        }

        if (command === '/system/resource/print') {
          const sequence = Number(value(sentence, '=', 'sequence'));
          // Deterministic stagger deliberately makes replies arrive in a
          // different order from command dispatch while preserving each
          // individual RouterOS sentence byte order.
          const delayMs = (17 - (sequence % 17)) % 17;
          setTimeout(() => {
            if (socket.destroyed) return;
            socket.write(
              Buffer.concat([
                encodeSentence(['!re', `=sequence=${sequence}`, `.tag=${tag}`]),
                encodeSentence(['!done', `.tag=${tag}`]),
              ]),
            );
          }, delayMs);
        }
      }
    });
  });

  const port = await listenServer(server);
  const client = new RouterOSClient({
    host: '127.0.0.1',
    port,
    username: 'admin',
    commandTimeoutMs: 2_000,
  });

  try {
    const results = await Promise.all(
      Array.from({ length: commandCount }, (_, sequence) =>
        client.execute('/system/resource/print', {
          attributes: { sequence },
          kind: 'read',
        }),
      ),
    );

    assert.equal(loginCount, 1, 'concurrent connect calls must share one login lifecycle');
    assert.equal(results.length, commandCount);
    for (let sequence = 0; sequence < commandCount; sequence += 1) {
      assert.equal(results[sequence]?.records[0]?.sequence, String(sequence));
    }
    assert.equal(client.pendingTags, 0);
  } finally {
    await client.close();
    await closeServer(server);
  }
});

test('multiple listen streams and normal commands can share one tagged connection safely', async () => {
  const listenerTags = new Map<string, string>();

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
          listenerTags.set('interface', tag);
          socket.write(
            encodeSentence(['!re', '=.id=*1', '=name=ether1', '=running=yes', `.tag=${tag}`]),
          );
          continue;
        }

        if (command === '/log/listen') {
          listenerTags.set('log', tag);
          socket.write(
            encodeSentence(['!re', '=.id=*A', '=topics=system,info', '=message=ready', `.tag=${tag}`]),
          );
          continue;
        }

        if (command === '/system/identity/print') {
          socket.write(
            Buffer.concat([
              encodeSentence(['!re', '=name=multiplex-router', `.tag=${tag}`]),
              encodeSentence(['!done', `.tag=${tag}`]),
            ]),
          );
          continue;
        }

        if (command === '/cancel') {
          const target = value(sentence, '=', 'tag');
          if (!target) continue;
          socket.write(
            Buffer.concat([
              encodeSentence([
                '!trap',
                '=category=2',
                '=message=interrupted',
                `.tag=${target}`,
              ]),
              encodeSentence(['!done', `.tag=${tag}`]),
              encodeSentence(['!done', `.tag=${target}`]),
            ]),
          );
        }
      }
    });
  });

  const port = await listenServer(server);
  const client = new RouterOSClient({ host: '127.0.0.1', port, username: 'admin' });

  try {
    const [interfaces, logs] = await Promise.all([
      client.listen('/interface'),
      client.listen('/log'),
    ]);

    const identityPromise = client.print('/system/identity');
    const [interfaceEvent, logEvent, identity] = await Promise.all([
      interfaces.nextReply(500),
      logs.nextReply(500),
      identityPromise,
    ]);

    assert.equal(interfaceEvent?.attributes.name, 'ether1');
    assert.equal(logEvent?.attributes.message, 'ready');
    assert.equal(identity[0]?.name, 'multiplex-router');
    assert.equal(listenerTags.get('interface'), interfaces.tag);
    assert.equal(listenerTags.get('log'), logs.tag);

    await Promise.all([interfaces.cancel(), logs.cancel()]);
    assert.equal(client.pendingTags, 0);
  } finally {
    await client.close();
    await closeServer(server);
  }
});
