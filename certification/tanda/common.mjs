import { readFileSync } from 'node:fs';
import { RouterOSClient, RouterOSTimeoutError } from '@bozz/routeros';

export function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function intEnv(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function createRouterClient() {
  const host = requiredEnv('ROUTEROS_HOST');
  const username = requiredEnv('ROUTEROS_USERNAME');
  const password = requiredEnv('ROUTEROS_PASSWORD');
  const tlsEnabled = process.env.ROUTEROS_TLS === '1' || process.env.ROUTEROS_TLS === 'true';
  const port = intEnv('ROUTEROS_PORT', tlsEnabled ? 8729 : 8728, { min: 1, max: 65535 });

  const options = {
    host,
    port,
    username,
    password,
    kind: tlsEnabled ? 'tls' : 'tcp',
    commandTimeoutMs: intEnv('ROUTEROS_COMMAND_TIMEOUT_MS', 10_000, { min: 100, max: 120_000 }),
    cancelTimeoutMs: intEnv('ROUTEROS_CANCEL_TIMEOUT_MS', 10_000, { min: 100, max: 120_000 }),
  };

  if (tlsEnabled) {
    const caFile = process.env.ROUTEROS_CA_FILE;
    const servername = process.env.ROUTEROS_TLS_SERVERNAME;
    options.tls = {
      ...(caFile ? { ca: readFileSync(caFile) } : {}),
      ...(servername ? { servername } : {}),
    };
  }

  return new RouterOSClient(options);
}

export function attachDiagnostics(client) {
  const diagnostics = {
    orphanReplies: 0,
    protocolErrors: 0,
    transportFaults: 0,
    disconnects: 0,
  };

  client.on('orphanReply', () => { diagnostics.orphanReplies += 1; });
  client.on('protocolError', () => { diagnostics.protocolErrors += 1; });
  client.on('transportFault', () => { diagnostics.transportFaults += 1; });
  client.on('disconnected', () => { diagnostics.disconnects += 1; });

  return diagnostics;
}

export function newEventCounters() {
  return { re: 0, empty: 0, trap: 0, done: 0, fatal: 0, dead: 0 };
}

const ROUTEROS_DEAD_VALUES = new Set(['true', 'yes']);

export function isRouterOSDeadReply(reply) {
  return reply.type === 're' && ROUTEROS_DEAD_VALUES.has(reply.attributes?.['.dead']);
}

export function countReply(counters, reply) {
  counters[reply.type] += 1;
  if (isRouterOSDeadReply(reply)) counters.dead += 1;
}

export async function collectFor(stream, durationMs, counters) {
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    try {
      const reply = await stream.nextReply(Math.max(1, Math.min(1_000, remaining)));
      if (reply === undefined) return;
      countReply(counters, reply);
    } catch (error) {
      if (error instanceof RouterOSTimeoutError) continue;
      throw error;
    }
  }
}

export async function drainClosedStream(stream, counters) {
  while (true) {
    const reply = await stream.nextReply();
    if (reply === undefined) return;
    countReply(counters, reply);
  }
}

export async function waitForMatchingReply(stream, timeoutMs, predicate, counters) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const reply = await stream.nextReply(Math.max(1, Math.min(1_000, deadline - Date.now())));
      if (reply === undefined) return undefined;
      countReply(counters, reply);
      if (predicate(reply)) return reply;
    } catch (error) {
      if (error instanceof RouterOSTimeoutError) continue;
      throw error;
    }
  }
  return undefined;
}

export function assertCleanDiagnostics(client, diagnostics) {
  if (client.pendingTags !== 0) throw new Error(`pendingTags leak: ${client.pendingTags}`);
  if (diagnostics.orphanReplies !== 0) throw new Error(`orphanReplies: ${diagnostics.orphanReplies}`);
  if (diagnostics.protocolErrors !== 0) throw new Error(`protocolErrors: ${diagnostics.protocolErrors}`);
  if (diagnostics.transportFaults !== 0) throw new Error(`transportFaults: ${diagnostics.transportFaults}`);
  if (diagnostics.disconnects !== 0) throw new Error(`unexpected disconnects: ${diagnostics.disconnects}`);
}

export function safeReport(report) {
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
