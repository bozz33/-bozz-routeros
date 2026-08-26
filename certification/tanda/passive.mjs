import assert from 'node:assert/strict';
import { routerOSQuery } from '@bozz/routeros';
import {
  assertCleanDiagnostics,
  attachDiagnostics,
  collectFor,
  createRouterClient,
  drainClosedStream,
  intEnv,
  newEventCounters,
  safeReport,
} from './common.mjs';

const client = createRouterClient();
const diagnostics = attachDiagnostics(client);
const observeMs = intEnv('ROUTEROS_OBSERVE_MS', 5_000, { min: 250, max: 300_000 });
const concurrency = intEnv('ROUTEROS_CONCURRENCY', 64, { min: 1, max: 512 });
const missingUser = `__bozz_routeros_rc1_missing_${Date.now()}__`;

const activeEvents = newEventCounters();
const userEvents = newEventCounters();

try {
  await client.connect();

  const [identity, resource] = await Promise.all([
    client.print('/system/identity', { attributes: { '.proplist': 'name' } }),
    client.print('/system/resource', { attributes: { '.proplist': 'version,uptime' } }),
  ]);

  assert.ok(identity[0]?.name, 'RouterOS identity is missing');
  assert.ok(resource[0]?.version, 'RouterOS version is missing');
  assert.ok(resource[0]?.uptime, 'RouterOS uptime is missing');

  const missingQuery = routerOSQuery().equals('user', missingUser).toWords();
  const [emptyActive, emptyUsers] = await Promise.all([
    client.print('/ip/hotspot/active', {
      attributes: { '.proplist': '.id,user' },
      queries: missingQuery,
    }),
    client.print('/ip/hotspot/user', {
      attributes: { '.proplist': '.id,name' },
      queries: routerOSQuery().equals('name', missingUser).toWords(),
    }),
  ]);

  assert.deepEqual(emptyActive, [], 'expected a real empty HotSpot active query');
  assert.deepEqual(emptyUsers, [], 'expected a real empty HotSpot user query');

  const concurrent = Array.from({ length: concurrency }, (_, index) => {
    if (index % 2 === 0) {
      return client.print('/ip/hotspot/active', {
        attributes: { '.proplist': '.id,user' },
        queries: missingQuery,
      });
    }
    return client.print('/ip/hotspot/user', {
      attributes: { '.proplist': '.id,name' },
      queries: routerOSQuery().equals('name', missingUser).toWords(),
    });
  });

  const concurrentResults = await Promise.all(concurrent);
  assert.ok(concurrentResults.every((rows) => rows.length === 0));

  // Keep listen requests protocol-minimal. MikroTik documents `.proplist` for
  // print; listen availability/attributes can vary by menu/version.
  const [activeStream, userStream] = await Promise.all([
    client.listen('/ip/hotspot/active', { maxQueuedReplies: 256 }),
    client.listen('/ip/hotspot/user', { maxQueuedReplies: 256 }),
  ]);

  await Promise.all([
    collectFor(activeStream, observeMs, activeEvents),
    collectFor(userStream, observeMs, userEvents),
  ]);

  await Promise.all([activeStream.cancel(), userStream.cancel()]);
  await Promise.all([
    drainClosedStream(activeStream, activeEvents),
    drainClosedStream(userStream, userEvents),
  ]);

  assert.equal(activeStream.queuedReplies, 0);
  assert.equal(userStream.queuedReplies, 0);
  assertCleanDiagnostics(client, diagnostics);

  safeReport({
    candidate: '2f67c90762718b3678cff9b553a95adbf95ce457',
    mode: 'tanda-passive',
    routerOSVersion: resource[0].version,
    routerUptime: resource[0].uptime,
    concurrency,
    observeMs,
    emptyActive: true,
    emptyUsers: true,
    activeEvents,
    userEvents,
    diagnostics,
    pendingTags: client.pendingTags,
    status: 'PASS',
  });
} finally {
  await client.close();
}
