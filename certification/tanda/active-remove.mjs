import assert from 'node:assert/strict';
import { routerOSQuery } from '@bozz/routeros';
import {
  assertCleanDiagnostics,
  attachDiagnostics,
  createRouterClient,
  drainClosedStream,
  intEnv,
  newEventCounters,
  requiredEnv,
  safeReport,
  waitForMatchingReply,
} from './common.mjs';

const CONFIRMATION = 'I_UNDERSTAND_TEST_SESSION_ONLY';
if (process.env.ROUTEROS_ALLOW_ACTIVE_REMOVE !== CONFIRMATION) {
  throw new Error(`ROUTEROS_ALLOW_ACTIVE_REMOVE must equal ${CONFIRMATION}`);
}

const testUser = requiredEnv('ROUTEROS_TEST_USER');
const timeoutMs = intEnv('ROUTEROS_REMOVE_TIMEOUT_MS', 30_000, { min: 1_000, max: 120_000 });
const client = createRouterClient();
const diagnostics = attachDiagnostics(client);
const activeEvents = newEventCounters();

try {
  await client.connect();

  const usersBefore = await client.print('/ip/hotspot/user', {
    attributes: { '.proplist': '.id,name,disabled' },
    queries: routerOSQuery().equals('name', testUser).toWords(),
  });
  assert.equal(usersBefore.length, 1, `Expected exactly one HotSpot user named ${testUser}`);

  const activeBefore = await client.print('/ip/hotspot/active', {
    attributes: { '.proplist': '.id,user' },
    queries: routerOSQuery().equals('user', testUser).toWords(),
  });
  assert.equal(
    activeBefore.length,
    1,
    `Refusing active/remove: expected exactly one active session for ${testUser}, got ${activeBefore.length}`,
  );

  const activeId = activeBefore[0]?.['.id'];
  assert.ok(activeId, 'The LAB active session has no RouterOS .id');

  const stream = await client.listen('/ip/hotspot/active', {
    attributes: { '.proplist': '.id,user,uptime,session-time-left' },
    maxQueuedReplies: 128,
  });

  const deadPromise = waitForMatchingReply(
    stream,
    timeoutMs,
    (reply) =>
      reply.type === 're' &&
      reply.attributes['.id'] === activeId &&
      reply.attributes.user === testUser &&
      reply.attributes['.dead'] === 'yes',
    activeEvents,
  );

  await client.execute('/ip/hotspot/active/remove', {
    attributes: { '.id': activeId },
    kind: 'write',
    timeoutMs,
  });

  const deadReply = await deadPromise;
  assert.ok(deadReply, `active/remove completed but .dead=yes was not observed for ${testUser}`);

  const activeAfter = await client.print('/ip/hotspot/active', {
    attributes: { '.proplist': '.id,user' },
    queries: routerOSQuery().equals('user', testUser).toWords(),
  });
  assert.equal(activeAfter.length, 0, 'LAB session is still active after active/remove');

  const usersAfter = await client.print('/ip/hotspot/user', {
    attributes: { '.proplist': '.id,name,disabled' },
    queries: routerOSQuery().equals('name', testUser).toWords(),
  });
  assert.equal(usersAfter.length, 1, 'HotSpot user account disappeared after active/remove');
  assert.equal(usersAfter[0]?.['.id'], usersBefore[0]?.['.id']);

  await stream.cancel();
  await drainClosedStream(stream, activeEvents);
  assertCleanDiagnostics(client, diagnostics);

  safeReport({
    candidate: '2f67c90762718b3678cff9b553a95adbf95ce457',
    mode: 'tanda-active-remove',
    testUser,
    removedSingleLabSession: true,
    userAccountPreserved: true,
    deadObserved: true,
    activeEvents,
    diagnostics,
    pendingTags: client.pendingTags,
    status: 'PASS',
  });
} finally {
  await client.close();
}
