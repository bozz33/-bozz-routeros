import assert from 'node:assert/strict';
import { RouterOSConnectionSupervisor } from '@bozz/routeros';
import {
  attachDiagnostics,
  createRouterClient,
  intEnv,
  safeReport,
} from '../tanda/common.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const timeoutMs = intEnv('ROUTEROS_RECONNECT_TIMEOUT_MS', 180_000, { min: 10_000, max: 900_000 });
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

  safeReport({
    type: 'reconnect-probe-ready',
    candidate: '8a3cd500aa5013577ca1f8179c916dc7807cf392',
    generation: initial.generation.toString(),
    timeoutMs,
    instruction: 'Interrupt only the certification client network path or reboot CHR now.',
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

  safeReport({
    type: 'reconnect-probe-final',
    candidate: '8a3cd500aa5013577ca1f8179c916dc7807cf392',
    initialGeneration: initial.generation.toString(),
    recoveredGeneration: recovered.generation.toString(),
    reconnectCount: recovered.reconnectCount,
    disconnectEvents,
    onlineEvents,
    diagnostics,
    postReconnectRead: true,
    status: 'PASS',
  });
} finally {
  await supervisor.stop();
}
