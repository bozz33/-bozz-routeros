import assert from 'node:assert/strict';
import test from 'node:test';
import { RouterOSRuntimeHealthMonitor } from '../src/index.js';

test('runtime health monitor validates sampling resolution', () => {
  assert.throws(() => new RouterOSRuntimeHealthMonitor({ resolutionMs: 0 }), RangeError);
  assert.throws(() => new RouterOSRuntimeHealthMonitor({ resolutionMs: 1.5 }), RangeError);
});

test('runtime health monitor is idempotent and returns finite process diagnostics', async () => {
  const monitor = new RouterOSRuntimeHealthMonitor({ resolutionMs: 10 });
  assert.equal(monitor.started, false);

  monitor.start();
  monitor.start();
  assert.equal(monitor.started, true);

  // Give monitorEventLoopDelay enough event-loop turns to collect samples
  // without asserting an exact sample count, which would be scheduler-dependent.
  await new Promise((resolve) => setTimeout(resolve, 30));

  const snapshot = monitor.snapshot();
  assert.ok(Number.isFinite(snapshot.observedAt));
  assert.ok(Number.isFinite(snapshot.eventLoopUtilization));
  assert.ok(snapshot.eventLoopUtilization >= 0 && snapshot.eventLoopUtilization <= 1);
  assert.ok(Number.isFinite(snapshot.eventLoopActiveMs));
  assert.ok(Number.isFinite(snapshot.eventLoopIdleMs));
  assert.ok(snapshot.eventLoopActiveMs >= 0);
  assert.ok(snapshot.eventLoopIdleMs >= 0);

  assert.ok(Number.isSafeInteger(snapshot.eventLoopDelay.count));
  assert.ok(snapshot.eventLoopDelay.count >= 0);
  for (const value of [
    snapshot.eventLoopDelay.minMs,
    snapshot.eventLoopDelay.maxMs,
    snapshot.eventLoopDelay.meanMs,
    snapshot.eventLoopDelay.p50Ms,
    snapshot.eventLoopDelay.p95Ms,
    snapshot.eventLoopDelay.p99Ms,
  ]) {
    assert.ok(Number.isFinite(value));
    assert.ok(value >= 0);
  }

  assert.ok(Number.isSafeInteger(snapshot.uv.loopCount));
  assert.ok(Number.isSafeInteger(snapshot.uv.events));
  assert.ok(Number.isSafeInteger(snapshot.uv.eventsWaiting));
  assert.ok(snapshot.uv.loopCount >= 0);
  assert.ok(snapshot.uv.events >= 0);
  assert.ok(snapshot.uv.eventsWaiting >= 0);

  monitor.reset();
  const afterReset = monitor.snapshot({ resetDelay: false });
  assert.ok(Number.isFinite(afterReset.eventLoopUtilization));

  monitor.stop();
  monitor.stop();
  assert.equal(monitor.started, false);
});
