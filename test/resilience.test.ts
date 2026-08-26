import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import {
  RouterOSAmbiguousWriteError,
  RouterOSClient,
  RouterOSFatalError,
  RouterOSStreamOverflowError,
  RouterOSTimeoutError,
  SentenceDecoder,
  encodeSentence,
} from '../src/index.js';

function apiValue(words: readonly string[], prefix: '=' | '.', key: string): string | undefined {
  const marker = `${prefix}${key}=`;
  const word = words.find((entry) => entry.startsWith(marker));
  return word?.slice(marker.length);
}

async function listenServer(server: net.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind test server');
  return address.port;
}

async function closeServer(server: net.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for test condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function createResilienceRouter(): net.Server {
  return net.createServer((socket) => {
    const decoder = new SentenceDecoder();
    let listenTag: string | undefined;

    socket.on('data', (chunk) => {
      for (const sentence of decoder.push(chunk)) {
        const command = sentence[0];
        const tag = apiValue(sentence, '.', 'tag');
        if (!command || !tag) continue;

        if (command === '/login') {
          socket.write(encodeSentence(['!done', `.tag=${tag}`]));
          continue;
        }

        if (command === '/system/resource/print') {
          const mode = apiValue(sentence, '=', 'mode');
          if (mode === 'fatal') {
            socket.write(encodeSentence(['!fatal', '=message=fatal-test']));
            continue;
          }
          if (mode === 'late') {
            setTimeout(() => {
              if (socket.destroyed) return;
              socket.write(encodeSentence(['!re', '=uptime=late', `.tag=${tag}`]));
              socket.write(encodeSentence(['!done', `.tag=${tag}`]));
            }, 40);
            continue;
          }
          socket.write(encodeSentence(['!re', '=uptime=ok', `.tag=${tag}`]));
          socket.write(encodeSentence(['!done', `.tag=${tag}`]));
          continue;
        }

        if (command === '/system/identity/print') {
          socket.write(encodeSentence(['!re', '=name=resilience-router', `.tag=${tag}`]));
          socket.write(encodeSentence(['!done', `.tag=${tag}`]));
          continue;
        }

        if (command === '/system/identity/set') {
          socket.destroy();
          continue;
        }

        if (command === '/interface/listen') {
          listenTag = tag;
          socket.write(encodeSentence(['!re', '=.id=*1', '=name=ether1', `.tag=${tag}`]));
          socket.write(encodeSentence(['!re', '=.id=*2', '=name=ether2', `.tag=${tag}`]));
          socket.write(encodeSentence(['!re', '=.id=*3', '=name=ether3', `.tag=${tag}`]));
          continue;
        }

        if (command === '/cancel' && apiValue(sentence, '=', 'tag') === listenTag) {
          socket.write(
            encodeSentence([
              '!trap',
              '=category=2',
              '=message=interrupted',
              `.tag=${listenTag}`,
            ]),
          );
          socket.write(encodeSentence(['!done', `.tag=${tag}`]));
          socket.write(encodeSentence(['!done', `.tag=${listenTag}`]));
        }
      }
    });
  });
}

test('untagged !fatal rejects pending work and releases all tags', async () => {
  const server = createResilienceRouter();
  const port = await listenServer(server);
  const client = new RouterOSClient({ host: '127.0.0.1', port, username: 'admin' });

  try {
    await assert.rejects(
      client.execute('/system/resource/print', {
        attributes: { mode: 'fatal' },
        kind: 'read',
      }),
      RouterOSFatalError,
    );
    assert.equal(client.pendingTags, 0);
  } finally {
    await client.close();
    await closeServer(server);
  }
});

test('late replies after a read timeout become orphans and do not poison the connection', async () => {
  const server = createResilienceRouter();
  const port = await listenServer(server);
  const client = new RouterOSClient({ host: '127.0.0.1', port, username: 'admin' });
  let orphanReplies = 0;
  client.on('orphanReply', () => {
    orphanReplies += 1;
  });

  try {
    await assert.rejects(
      client.execute('/system/resource/print', {
        attributes: { mode: 'late' },
        kind: 'read',
        timeoutMs: 10,
      }),
      RouterOSTimeoutError,
    );

    await waitFor(() => orphanReplies >= 2);
    assert.equal(client.pendingTags, 0);

    const identity = await client.print('/system/identity');
    assert.equal(identity[0]?.name, 'resilience-router');
  } finally {
    await client.close();
    await closeServer(server);
  }
});

test('socket loss after dispatching a mutation is classified as ambiguous', async () => {
  const server = createResilienceRouter();
  const port = await listenServer(server);
  const client = new RouterOSClient({ host: '127.0.0.1', port, username: 'admin' });

  try {
    await assert.rejects(
      client.execute('/system/identity/set', {
        attributes: { name: 'new-name' },
        kind: 'write',
      }),
      RouterOSAmbiguousWriteError,
    );
    assert.equal(client.pendingTags, 0);
  } finally {
    await client.close();
    await closeServer(server);
  }
});

test('listen overflow fails locally and automatically cancels the remote RouterOS listener', async () => {
  const server = createResilienceRouter();
  const port = await listenServer(server);
  const client = new RouterOSClient({ host: '127.0.0.1', port, username: 'admin' });

  try {
    const stream = await client.listen('/interface', {
      maxQueuedReplies: 1,
      overflowPolicy: 'error',
    });

    let sawOverflow = false;
    const deliveredNames: string[] = [];
    for (let attempt = 0; attempt < 4 && !sawOverflow; attempt += 1) {
      try {
        const reply = await stream.nextReply(500);
        if (reply?.attributes.name) deliveredNames.push(reply.attributes.name);
      } catch (error) {
        assert.ok(error instanceof RouterOSStreamOverflowError);
        sawOverflow = true;
      }
    }

    assert.equal(sawOverflow, true);
    assert.ok(deliveredNames.includes('ether1'));
    await waitFor(() => client.pendingTags === 0);
    assert.equal(stream.closed, true);
  } finally {
    await client.close();
    await closeServer(server);
  }
});
