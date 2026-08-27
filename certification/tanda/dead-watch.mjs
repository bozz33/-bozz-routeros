import assert from 'node:assert/strict';
import { routerOSQuery } from '@bozz/routeros';
import {
  assertCleanDiagnostics,
  attachDiagnostics,
  collectFor,
  createRouterClient,
  drainClosedStream,
  intEnv,
  isRouterOSDeadReply,
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

  // Dead replies are only guaranteed to identify the vanished item by `.id`;
  // they do not have to repeat every prior field such as `user`. RouterOS
  // 7.24.1 emits `.dead=true`; earlier observations/examples used `yes`.
  const activeIds = new Set(
    (await client.print('/ip/hotspot/active', {
      attributes: { '.proplist': '.id,user' },
      queries: routerOSQuery().equals('user', testUser).toWords(),
    }))
      .map((row) => row['.id'])
      .filter(Boolean),
  );

  const [activeStream, userStream] = await Promise.all([
    client.listen('/ip/hotspot/active', { maxQueuedReplies: 256 }),
    client.listen('/ip/hotspot/user', { maxQueuedReplies: 256 }),
  ]);

  process.stderr.write(
    `Watching RouterOS active stream for a .dead=true/yes marker on LAB user ${testUser}. ` +
    `Log that LAB client in/out within ${timeoutMs}ms.\n`,
  );

  const userCollector = collectFor(userStream, timeoutMs, userEvents);
  const deadReply = await waitForMatchingReply(
    activeStream,
    timeoutMs,
    (reply) => {
      if (reply.type !== 're') return false;
      const id = reply.attributes['.id'];
      if (!id) return false;

      if (!isRouterOSDeadReply(reply) && reply.attributes.user === testUser) {
        activeIds.add(id);
        return false;
      }

      return isRouterOSDeadReply(reply) && activeIds.has(id);
    },
    activeEvents,
  );

  assert.ok(deadReply, `No correlated .dead=true/yes event observed for LAB user ${testUser}`);

  await Promise.all([activeStream.cancel(), userStream.cancel()]);
  await userCollector;
  await Promise.all([
    drainClosedStream(activeStream, activeEvents),
    drainClosedStream(userStream, userEvents),
  ]);

  assertCleanDiagnostics(client, diagnostics);

  safeReport({
    candidate: '8a3cd500aa5013577ca1f8179c916dc7807cf392',
    mode: 'tanda-dead-watch',
    testUser,
    deadObserved: true,
    deadValue: deadReply.attributes['.dead'],
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
