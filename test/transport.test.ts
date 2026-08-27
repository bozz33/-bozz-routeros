import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { SocketTransport, resolveTlsServername } from '../src/index.js';

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

test('TLS SNI defaults to DNS hosts but not IP literals', () => {
  assert.equal(resolveTlsServername('router.example.net', {}), 'router.example.net');
  assert.equal(resolveTlsServername('192.0.2.10', {}), undefined);
  assert.equal(resolveTlsServername('2001:db8::10', {}), undefined);
  assert.equal(resolveTlsServername('192.0.2.10', { servername: 'router.example.net' }), 'router.example.net');
  assert.equal(resolveTlsServername('router.example.net', { servername: '' }), '');
  assert.throws(
    () => resolveTlsServername('router.example.net', { servername: '192.0.2.10' }),
    TypeError,
  );
});

test('physical socket writes are serialized while callers may enqueue concurrently', async () => {
  const received: number[] = [];
  let resolveReceived!: () => void;
  const allReceived = new Promise<void>((resolve) => {
    resolveReceived = resolve;
  });

  const server = net.createServer((socket) => {
    socket.on('data', (chunk) => {
      for (const byte of chunk) received.push(byte);
      if (received.length >= 6) resolveReceived();
    });
  });
  const port = await listenServer(server);
  const transport = new SocketTransport({ host: '127.0.0.1', port });

  try {
    await transport.connect();
    await Promise.all([
      transport.write(Uint8Array.from([1, 2])),
      transport.write(Uint8Array.from([3, 4])),
      transport.write(Uint8Array.from([5, 6])),
    ]);
    await allReceived;
    assert.deepEqual(received, [1, 2, 3, 4, 5, 6]);
  } finally {
    await transport.close();
    await closeServer(server);
  }
});
