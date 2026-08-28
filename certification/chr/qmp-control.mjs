import { createConnection } from 'node:net';
import {
  isQmpActionComplete,
  observeQmpActionMessage,
  validateQmpActionObservation,
} from './qmp-protocol.mjs';

const [socketPath, action] = process.argv.slice(2);

if (!socketPath || !action) {
  throw new Error('Usage: node certification/chr/qmp-control.mjs <qmp.sock> <status|link-down|link-up|reset>');
}

const commands = {
  status: { execute: 'query-status' },
  'link-down': { execute: 'set_link', arguments: { name: 'nic0', up: false } },
  'link-up': { execute: 'set_link', arguments: { name: 'nic0', up: true } },
  reset: { execute: 'system_reset' },
};

const requested = commands[action];
if (!requested) throw new Error(`Unsupported QMP action: ${action}`);

function lineReader(socket) {
  let buffer = '';
  const queue = [];
  const waiters = [];

  const settle = (value) => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(value);
    else queue.push(value);
  };

  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) settle(JSON.parse(line));
    }
  });
  socket.on('error', (error) => {
    while (waiters.length > 0) waiters.shift().reject(error);
  });
  socket.on('close', () => {
    const error = new Error('QMP socket closed before the expected response');
    while (waiters.length > 0) waiters.shift().reject(error);
  });

  return () => {
    if (queue.length > 0) return Promise.resolve(queue.shift());
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  };
}

async function responseFor(readLine, predicate) {
  while (true) {
    const message = await readLine();
    if (predicate(message)) return message;
  }
}

const socket = createConnection({ path: socketPath });
socket.setTimeout(10_000, () => {
  socket.destroy(new Error('QMP action timed out after 10000ms'));
});
const readLine = lineReader(socket);

try {
  const greeting = await responseFor(readLine, (message) => message.QMP);
  socket.write(`${JSON.stringify({ execute: 'qmp_capabilities' })}\n`);
  const capabilities = await responseFor(readLine, (message) => message.return || message.error);
  if (capabilities.error) throw new Error(`QMP capabilities failed: ${JSON.stringify(capabilities.error)}`);

  socket.write(`${JSON.stringify(requested)}\n`);
  let observation = {};
  while (!isQmpActionComplete(observation, action)) {
    const message = await readLine();
    observation = observeQmpActionMessage(observation, message);
  }
  const resetEvent = validateQmpActionObservation(observation, action);

  process.stdout.write(`${JSON.stringify({
    type: 'chr-qmp-action',
    action,
    qemu: greeting.QMP.version.qemu,
    ...(resetEvent ? { resetEvent } : {}),
    status: 'PASS',
  })}\n`);
} finally {
  socket.end();
}
