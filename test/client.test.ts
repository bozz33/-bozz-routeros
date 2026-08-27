import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import {
  RouterOSAmbiguousWriteError,
  RouterOSClient,
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

interface MockControl {
  readonly server: net.Server;
  readonly emptySent: Promise<void>;
  releaseEmptyDone(): void;
}

function createMockRouterOS(): MockControl {
  let resolveEmptySent!: () => void;
  let resolveEmptyDone!: () => void;
  const emptySent = new Promise<void>((resolve) => {
    resolveEmptySent = resolve;
  });
  const emptyDone = new Promise<void>((resolve) => {
    resolveEmptyDone = resolve;
  });

  const server = net.createServer((socket) => {
    const decoder = new SentenceDecoder();
    let listenTag: string | undefined;

    socket.on('data', (chunk) => {
      for (const sentence of decoder.push(chunk)) {
        const command = sentence[0];
        const tag = apiValue(sentence, '.', 'tag');
        if (!command || !tag) continue;

        if (command === '/login') {
          socket.write(encodeSentence(['!done', `.tag=${tag}`]));
          queueMicrotask(() => {
            socket.write(encodeSentence(['!re', '=name=orphan', '.tag=GHOST']));
          });
          continue;
        }

        if (command === '/system/resource/print') {
          const slow = apiValue(sentence, '=', 'slow') === 'yes';
          const send = () => {
            socket.write(
              encodeSentence(['!re', '=uptime=1d2h', '=cpu-load=7', `.tag=${tag}`]),
            );
            socket.write(encodeSentence(['!done', `.tag=${tag}`]));
          };
          if (slow) setTimeout(send, 15);
          else send();
          continue;
        }

        if (command === '/system/identity/print') {
          socket.write(encodeSentence(['!re', '=name=router-lab', `.tag=${tag}`]));
          socket.write(encodeSentence(['!done', `.tag=${tag}`]));
          continue;
        }

        if (command === '/ip/hotspot/active/print') {
          socket.write(encodeSentence(['!empty', `.tag=${tag}`]));
          resolveEmptySent();
          void emptyDone.then(() => {
            if (!socket.destroyed) socket.write(encodeSentence(['!done', `.tag=${tag}`]));
          });
          continue;
        }

        if (command === '/system/identity/set') {
          if (apiValue(sentence, '=', 'name') !== 'hang') {
            socket.write(encodeSentence(['!done', `.tag=${tag}`]));
          }
          continue;
        }

        if (command === '/interface/listen') {
          listenTag = tag;
          socket.write(
            encodeSentence([
              '!re',
              '=.id=*1',
              '=name=ether1',
              '=running=yes',
              `.tag=${tag}`,
            ]),
          );
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

  return {
    server,
    emptySent,
    releaseEmptyDone: resolveEmptyDone,
  };
}

test('client handles login, concurrent tags and orphan replies without losing the connection', async () => {
  const mock = createMockRouterOS();
  const port = await listenServer(mock.server);
  const client = new RouterOSClient({
    host: '127.0.0.1',
    port,
    username: 'admin',
    password: '',
  });

  let orphanReplies = 0;
  client.on('orphanReply', () => {
    orphanReplies += 1;
  });

  try {
    await client.connect();
    await new Promise((resolve) => setImmediate(resolve));

    const [resource, identity] = await Promise.all([
      client.execute('/system/resource/print', {
        attributes: { slow: true },
        kind: 'read',
      }),
      client.print('/system/identity'),
    ]);

    assert.equal(resource.records[0]?.uptime, '1d2h');
    assert.equal(identity[0]?.name, 'router-lab');
    assert.equal(orphanReplies, 1);
    assert.equal(client.pendingTags, 0);
  } finally {
    await client.close();
    await closeServer(mock.server);
  }
});

test('!empty is successful but does not complete the command before matching !done', async () => {
  const mock = createMockRouterOS();
  const port = await listenServer(mock.server);
  const client = new RouterOSClient({ host: '127.0.0.1', port, username: 'admin' });

  try {
    const resultPromise = client.print('/ip/hotspot/active');
    await mock.emptySent;

    let settled = false;
    void resultPromise.finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);

    mock.releaseEmptyDone();
    const records = await resultPromise;
    assert.deepEqual(records, []);
    assert.equal(client.pendingTags, 0);
  } finally {
    await client.close();
    await closeServer(mock.server);
  }
});

test('listen cancellation tracks cancel-tag and listener-tag independently', async () => {
  const mock = createMockRouterOS();
  const port = await listenServer(mock.server);
  const client = new RouterOSClient({ host: '127.0.0.1', port, username: 'admin' });

  try {
    const stream = await client.listen('/interface', { maxQueuedReplies: 8 });
    const first = await stream.nextReply(500);
    assert.equal(first?.type, 're');
    assert.equal(first?.attributes.name, 'ether1');

    await stream.cancel();
    assert.equal(stream.closed, true);
    assert.equal(client.pendingTags, 0);

    const interrupted = await stream.nextReply();
    assert.equal(interrupted?.type, 'trap');
    assert.equal(interrupted?.attributes.message, 'interrupted');
    assert.equal(await stream.nextReply(), undefined);
  } finally {
    await client.close();
    await closeServer(mock.server);
  }
});

test('timed-out mutation is reported as ambiguous rather than safe-to-retry failure', async () => {
  const mock = createMockRouterOS();
  const port = await listenServer(mock.server);
  const client = new RouterOSClient({ host: '127.0.0.1', port, username: 'admin' });

  try {
    await assert.rejects(
      client.execute('/system/identity/set', {
        attributes: { name: 'hang' },
        kind: 'write',
        timeoutMs: 25,
      }),
      RouterOSAmbiguousWriteError,
    );
    assert.equal(client.pendingTags, 0);
  } finally {
    await client.close();
    await closeServer(mock.server);
  }
});
