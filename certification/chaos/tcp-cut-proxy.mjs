import { createServer, connect } from 'node:net';

function integer(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

const listenHost = process.env.CHAOS_LISTEN_HOST ?? '127.0.0.1';
const listenPort = integer('CHAOS_LISTEN_PORT', 28728, 1, 65535);
const targetHost = process.env.CHAOS_TARGET_HOST ?? '127.0.0.1';
const targetPort = integer('CHAOS_TARGET_PORT', 18728, 1, 65535);
const outageMs = integer('CHAOS_OUTAGE_MS', 5_000, 100, 120_000);
const pairs = new Set();
let server;
let cutting = false;

function report(payload) {
  process.stdout.write(`${JSON.stringify({
    type: 'tcp-cut-proxy',
    timestamp: new Date().toISOString(),
    ...payload,
  })}\n`);
}

function destroyPair(pair) {
  pair.client.destroy();
  pair.target.destroy();
  pairs.delete(pair);
}

function start() {
  server = createServer((client) => {
    const target = connect({ host: targetHost, port: targetPort });
    const pair = { client, target };
    pairs.add(pair);

    client.pipe(target);
    target.pipe(client);
    client.on('error', () => destroyPair(pair));
    target.on('error', () => destroyPair(pair));
    client.on('close', () => destroyPair(pair));
    target.on('close', () => destroyPair(pair));
  });
  server.on('error', (error) => {
    report({ event: 'fault', message: error.message, status: 'FAIL' });
    process.exitCode = 1;
  });
  server.listen(listenPort, listenHost, () => {
    report({
      event: 'listening',
      listen: `${listenHost}:${listenPort}`,
      target: `${targetHost}:${targetPort}`,
      status: 'READY',
    });
  });
}

function cut() {
  if (cutting) return;
  cutting = true;
  for (const pair of [...pairs]) destroyPair(pair);
  server.close(() => {
    report({ event: 'cut', outageMs, status: 'ACTIVE' });
    setTimeout(() => {
      cutting = false;
      start();
      report({ event: 'restored', status: 'PASS' });
    }, outageMs);
  });
}

function stop(signal) {
  for (const pair of [...pairs]) destroyPair(pair);
  server?.close(() => {
    report({ event: 'stopped', signal, status: 'PASS' });
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.on('SIGUSR1', cut);
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
start();
