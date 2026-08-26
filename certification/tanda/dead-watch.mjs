import assert from 'node:assert/strict';
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

const testUser = requiredEnv('ROUTEROS_TEST_USER');
const timeoutMs = intEnv('ROUTEROS_DEAD_TIMEOUT_MS', 120_000, { min: 1_000, max: 900_000 });
const client = createRouterClient();
const diagnostics = attachDiagnostics(client);
const activeEvents = newEventCounters();
const userEvents = newEventCounters();

try {
  await client.connect();

  const [activeStream, userStream] = await Promise.all([
    client.listen('/ip/hotspot/active', {
      attributes: { '.proplist': '.id,user,uptime,session-time-left' },
      maxQueuedReplies: 256,
    }),
    client.listen('/ip/hotspot/user', {
      attributes: { '.proplist': '.id,name,uptime,limit-uptime,disabled' },
      maxQueuedReplies: 256,
    }),
  ]);

  process.stderr.write(
    `Watching RouterOS active stream for .dead=yes on LAB user ${testUser}. ` +
    `Log that LAB client in/out within ${timeoutMs}ms.\n`,
  );

  const deadPromise = waitForMatchingReply(
    activeStream,
    timeoutMs,
    (reply) =>
      reply.type === 're' &&
      reply.attributes.user === testUser &&
      reply.attributes['.dead'] === 'yes',
    activeEvents,
  );

  const userObservation = waitForMatchingReply(
    userStream,
    timeoutMs,
    (reply) => reply.type === 're' && reply.attributes.name === testUser,
    userEvents,
  );

  const deadReply = await deadPromise;
  assert.ok(deadReply, `No .dead=yes event observed for LAB user ${testUser}`);

  await Promise.all([activeStream.cancel(), userStream.cancel()]);
  await Promise.all([
    drainClosedStream(activeStream, activeEvents),
    drainClosedStream(userStream, userEvents),
  ]);
  await userObservation.catch(() => undefined);

  assertCleanDiagnostics(client, diagnostics);

  safeReport({
    candidate: '2f67c90762718b3678cff9b553a95adbf95ce457',
    mode: 'tanda-dead-watch',
    testUser,
    deadObserved: true,
    timeoutMs,
    activeEvents,
    userEvents,
    diagnostics,
    pendingTags: client.pendingTags,
    status: 'PASS',
  });
} finally {
  await client.close();
}
