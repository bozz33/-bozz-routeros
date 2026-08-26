import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import test from 'node:test';
import { RouterOSConnectionError, SocketTransport } from '../src/index.js';

const opensslAvailable = spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0;

interface TestPki {
  readonly directory: string;
  readonly ca: Buffer;
  readonly cert: Buffer;
  readonly key: Buffer;
  cleanup(): void;
}

function createTestPki(): TestPki {
  const directory = mkdtempSync(join(tmpdir(), 'bozz-routeros-tls-'));
  const caKey = join(directory, 'ca-key.pem');
  const caCert = join(directory, 'ca-cert.pem');
  const serverKey = join(directory, 'server-key.pem');
  const serverCsr = join(directory, 'server.csr');
  const serverCert = join(directory, 'server-cert.pem');
  const extFile = join(directory, 'server.ext');

  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-days',
      '1',
      '-subj',
      '/CN=BOZZ RouterOS Test CA',
      '-keyout',
      caKey,
      '-out',
      caCert,
    ],
    { stdio: 'ignore' },
  );

  execFileSync(
    'openssl',
    [
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-subj',
      '/CN=router.test',
      '-keyout',
      serverKey,
      '-out',
      serverCsr,
    ],
    { stdio: 'ignore' },
  );

  writeFileSync(
    extFile,
    [
      'subjectAltName=DNS:router.test,IP:127.0.0.1',
      'extendedKeyUsage=serverAuth',
      'keyUsage=digitalSignature,keyEncipherment',
      '',
    ].join('\n'),
  );

  execFileSync(
    'openssl',
    [
      'x509',
      '-req',
      '-in',
      serverCsr,
      '-CA',
      caCert,
      '-CAkey',
      caKey,
      '-CAcreateserial',
      '-out',
      serverCert,
      '-days',
      '1',
      '-sha256',
      '-extfile',
      extFile,
    ],
    { stdio: 'ignore' },
  );

  return {
    directory,
    ca: readFileSync(caCert),
    cert: readFileSync(serverCert),
    key: readFileSync(serverKey),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

async function listenTls(server: tls.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind TLS test server');
  return address.port;
}

async function closeTls(server: tls.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test(
  'TLS transport verifies CA and DNS identity and carries RouterOS bytes',
  { skip: opensslAvailable ? false : 'OpenSSL CLI is unavailable' },
  async () => {
    const pki = createTestPki();
    let received = Buffer.alloc(0);
    const server = tls.createServer({ key: pki.key, cert: pki.cert }, (socket) => {
      socket.on('data', (chunk) => {
        received = Buffer.concat([received, chunk]);
      });
    });
    const port = await listenTls(server);
    const transport = new SocketTransport({
      host: '127.0.0.1',
      port,
      kind: 'tls',
      tls: {
        ca: pki.ca,
        servername: 'router.test',
      },
    });

    try {
      await transport.connect();
      await transport.write(Uint8Array.from([0x2a, 0x2b, 0x2c]));
      const deadline = Date.now() + 500;
      while (received.length < 3 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.deepEqual([...received], [0x2a, 0x2b, 0x2c]);
    } finally {
      await transport.close();
      await closeTls(server);
      pki.cleanup();
    }
  },
);

test(
  'TLS transport rejects an untrusted RouterOS certificate by default',
  { skip: opensslAvailable ? false : 'OpenSSL CLI is unavailable' },
  async () => {
    const pki = createTestPki();
    const server = tls.createServer({ key: pki.key, cert: pki.cert });
    const port = await listenTls(server);
    const transport = new SocketTransport({
      host: '127.0.0.1',
      port,
      kind: 'tls',
      tls: { servername: 'router.test' },
    });

    try {
      await assert.rejects(transport.connect(), RouterOSConnectionError);
    } finally {
      await transport.close();
      await closeTls(server);
      pki.cleanup();
    }
  },
);

test(
  'TLS transport rejects a trusted certificate with the wrong server identity',
  { skip: opensslAvailable ? false : 'OpenSSL CLI is unavailable' },
  async () => {
    const pki = createTestPki();
    const server = tls.createServer({ key: pki.key, cert: pki.cert });
    const port = await listenTls(server);
    const transport = new SocketTransport({
      host: '127.0.0.1',
      port,
      kind: 'tls',
      tls: {
        ca: pki.ca,
        servername: 'wrong-router.test',
      },
    });

    try {
      await assert.rejects(transport.connect(), RouterOSConnectionError);
    } finally {
      await transport.close();
      await closeTls(server);
      pki.cleanup();
    }
  },
);
