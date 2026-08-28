import assert from 'node:assert/strict';
import { RouterOSConnectionSupervisor } from '@bozz/routeros';
import {
  attachDiagnostics,
  createRouterClient,
  intEnv,
  safeReport,
} from '../tanda/common.mjs';
import {
  parseRouterOSDurationSeconds,
  validateRebootEvidence,
} from './reboot-evidence.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const timeoutMs = intEnv('ROUTEROS_RECONNECT_TIMEOUT_MS', 180_000, { min: 10_000, max: 900_000 });
const expectation = process.env.ROUTEROS_RECONNECT_EXPECTATION ?? 'network';
assert.ok(['network', 'reboot'].includes(expectation),
  'ROUTEROS_RECONNECT_EXPECTATION must be network or reboot');
const minimumInitialUptimeSeconds = intEnv(
  'ROUTEROS_REBOOT_MIN_INITIAL_UPTIME_SECONDS',
  30,
  { min: 10, max: 3_600 },
);
const client = createRouterClient();
const diagnostics = attachDiagnostics(client);
const supervisor = new RouterOSConnectionSupervisor({
  client,
  reconnect: {
    initialDelayMs: 250,
    maxDelayMs: 5_000,
    multiplier: 2,
    jitter: 'full',
    resetAfterStableMs: 10_000,
  },
});

let onlineEvents = 0;
let disconnectEvents = 0;
supervisor.on('online', () => { onlineEvents += 1; });
client.on('disconnected', () => { disconnectEvents += 1; });

try {
  await supervisor.start();
  const initial = supervisor.snapshot();
  assert.equal(initial.state, 'online');
  assert.ok(initial.generation >= 1n);

  let initialUptime;
  let initialUptimeSeconds;
  if (expectation === 'reboot') {
    const resource = await client.print('/system/resource', {
      attributes: { '.proplist': 'uptime' },
    });
    initialUptime = resource[0]?.uptime;
    assert.equal(typeof initialUptime, 'string', 'Initial RouterOS uptime is unavailable');
    initialUptimeSeconds = parseRouterOSDurationSeconds(initialUptime);
    assert.ok(
      initialUptimeSeconds >= minimumInitialUptimeSeconds,
      `Initial RouterOS uptime ${initialUptimeSeconds}s is below the required ${minimumInitialUptimeSeconds}s`,
    );
  }

  safeReport({
    type: 'reconnect-probe-ready',
    candidate: '8a3cd500aa5013577ca1f8179c916dc7807cf392',
    generation: initial.generation.toString(),
    timeoutMs,
    expectation,
    ...(initialUptime === undefined ? {} : {
      initialUptime,
      initialUptimeSeconds,
      minimumInitialUptimeSeconds,
    }),
    instruction: expectation === 'reboot'
      ? 'Reset only disposable CHR through QMP, then cut the dedicated certification proxy.'
      : 'Interrupt only the certification client network path now.',
  });

  const deadline = Date.now() + timeoutMs;
  let recovered;
  while (Date.now() < deadline) {
    await sleep(500);
    const snapshot = supervisor.snapshot();
    if (snapshot.generation > initial.generation && snapshot.state === 'online') {
      recovered = snapshot;
      break;
    }
  }

  assert.ok(recovered, `No reconnect generation observed within ${timeoutMs}ms`);
  assert.ok(disconnectEvents >= 1, 'No real client disconnect event was observed');
  assert.ok(onlineEvents >= 2, 'Supervisor did not return online after the interruption');
  assert.equal(diagnostics.orphanReplies, 0, 'Reconnect produced orphan RouterOS replies');
  assert.equal(diagnostics.protocolErrors, 0, 'Reconnect produced RouterOS protocol errors');

  const identity = await client.print('/system/identity', {
    attributes: { '.proplist': 'name' },
  });
  assert.ok(identity[0]?.name, 'Post-reconnect RouterOS command failed');

  let rebootEvidence;
  if (expectation === 'reboot') {
    const resource = await client.print('/system/resource', {
      attributes: { '.proplist': 'uptime' },
    });
    const recoveredUptime = resource[0]?.uptime;
    assert.equal(typeof recoveredUptime, 'string', 'Recovered RouterOS uptime is unavailable');
    rebootEvidence = validateRebootEvidence({
      initialUptime,
      recoveredUptime,
      minimumInitialUptimeSeconds,
    });
  }

  safeReport({
    type: 'reconnect-probe-final',
    candidate: '8a3cd500aa5013577ca1f8179c916dc7807cf392',
    initialGeneration: initial.generation.toString(),
    recoveredGeneration: recovered.generation.toString(),
    reconnectCount: recovered.reconnectCount,
    disconnectEvents,
    onlineEvents,
    diagnostics,
    expectation,
    ...(rebootEvidence ?? {}),
    postReconnectRead: true,
    status: 'PASS',
  });
} finally {
  await supervisor.stop();
}
