import {
  RouterOSRuntimeHealthMonitor,
  RouterOSTimeoutError,
} from '@bozz/routeros';
import {
  assertCleanDiagnostics,
  attachDiagnostics,
  countReply,
  createRouterClient,
  drainClosedStream,
  intEnv,
  newEventCounters,
  safeReport,
} from './common.mjs';

function resourceCounts() {
  const counts = {};
  for (const type of process.getActiveResourcesInfo()) {
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function consume(stream, counters, state) {
  while (!state.stopping) {
    try {
      const reply = await stream.nextReply(1_000);
      if (reply === undefined) return;
      countReply(counters, reply);
    } catch (error) {
      if (error instanceof RouterOSTimeoutError) continue;
      state.error = error;
      throw error;
    }
  }
}

const durationSeconds = intEnv('ROUTEROS_SOAK_SECONDS', 7_200, { min: 60, max: 86_400 });
const sampleSeconds = intEnv('ROUTEROS_SOAK_SAMPLE_SECONDS', 60, { min: 5, max: 3_600 });
const durationMs = durationSeconds * 1_000;
const sampleMs = sampleSeconds * 1_000;

const client = createRouterClient();
const diagnostics = attachDiagnostics(client);
const activeEvents = newEventCounters();
const userEvents = newEventCounters();
const runtime = new RouterOSRuntimeHealthMonitor({ resolutionMs: 20 });
const state = { stopping: false, error: undefined };
const startedAt = Date.now();
const cpuBaseline = process.cpuUsage();
const memoryBaseline = process.memoryUsage();
const resourcesBaseline = resourceCounts();

try {
  await client.connect();

  const [resource] = await Promise.all([
    client.print('/system/resource', { attributes: { '.proplist': 'version,uptime' } }),
  ]);

  const [activeStream, userStream] = await Promise.all([
    client.listen('/ip/hotspot/active', {
      attributes: { '.proplist': '.id,user,uptime,session-time-left' },
      maxQueuedReplies: 4_096,
    }),
    client.listen('/ip/hotspot/user', {
      attributes: { '.proplist': '.id,name,uptime,limit-uptime,disabled' },
      maxQueuedReplies: 4_096,
    }),
  ]);

  runtime.start();
  const consumers = [
    consume(activeStream, activeEvents, state),
    consume(userStream, userEvents, state),
  ];

  safeReport({
    type: 'soak-start',
    candidate: '2f67c90762718b3678cff9b553a95adbf95ce457',
    routerOSVersion: resource[0]?.version,
    durationSeconds,
    sampleSeconds,
    memoryBaseline,
    resourcesBaseline,
  });

  while (Date.now() - startedAt < durationMs) {
    await sleep(Math.min(sampleMs, Math.max(1, durationMs - (Date.now() - startedAt))));
    if (state.error) throw state.error;

    const memory = process.memoryUsage();
    const cpu = process.cpuUsage(cpuBaseline);
    const health = runtime.snapshot();

    safeReport({
      type: 'soak-sample',
      elapsedSeconds: Math.floor((Date.now() - startedAt) / 1_000),
      memory,
      memoryDelta: {
        rss: memory.rss - memoryBaseline.rss,
        heapUsed: memory.heapUsed - memoryBaseline.heapUsed,
        external: memory.external - memoryBaseline.external,
        arrayBuffers: memory.arrayBuffers - memoryBaseline.arrayBuffers,
      },
      cpu,
      activeResources: resourceCounts(),
      pendingTags: client.pendingTags,
      queuedReplies: {
        active: activeStream.queuedReplies,
        users: userStream.queuedReplies,
      },
      events: {
        active: activeEvents,
        users: userEvents,
      },
      diagnostics,
      runtime: health,
    });
  }

  state.stopping = true;
  await Promise.all([activeStream.cancel(), userStream.cancel()]);
  await Promise.allSettled(consumers);
  await Promise.all([
    drainClosedStream(activeStream, activeEvents),
    drainClosedStream(userStream, userEvents),
  ]);

  runtime.stop();
  assertCleanDiagnostics(client, diagnostics);

  const finalMemory = process.memoryUsage();
  safeReport({
    type: 'soak-final',
    candidate: '2f67c90762718b3678cff9b553a95adbf95ce457',
    elapsedSeconds: Math.floor((Date.now() - startedAt) / 1_000),
    finalMemory,
    memoryDelta: {
      rss: finalMemory.rss - memoryBaseline.rss,
      heapUsed: finalMemory.heapUsed - memoryBaseline.heapUsed,
      external: finalMemory.external - memoryBaseline.external,
      arrayBuffers: finalMemory.arrayBuffers - memoryBaseline.arrayBuffers,
    },
    activeResources: resourceCounts(),
    resourcesBaseline,
    pendingTags: client.pendingTags,
    queuedReplies: {
      active: activeStream.queuedReplies,
      users: userStream.queuedReplies,
    },
    activeEvents,
    userEvents,
    diagnostics,
    status: 'PASS',
  });
} finally {
  state.stopping = true;
  runtime.stop();
  await client.close();
}
