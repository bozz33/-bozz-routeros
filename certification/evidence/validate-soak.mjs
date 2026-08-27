import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

function integerEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function linearSlopePerHour(samples, selector) {
  const points = samples.map((sample) => [sample.elapsedSeconds, selector(sample)]);
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / points.length;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
  const denominator = points.reduce((sum, [x]) => sum + ((x - meanX) ** 2), 0);
  assert.ok(denominator > 0, 'soak samples do not span enough time for a memory slope');
  const bytesPerSecond = points.reduce(
    (sum, [x, y]) => sum + ((x - meanX) * (y - meanY)),
    0,
  ) / denominator;
  return bytesPerSecond * 3_600;
}

function assertDiagnosticsClean(diagnostics, context) {
  for (const key of ['orphanReplies', 'protocolErrors', 'transportFaults', 'disconnects']) {
    assert.equal(diagnostics?.[key], 0, `${context}: ${key} must be zero`);
  }
}

function eventTotal(events) {
  return ['re', 'empty', 'trap', 'done', 'fatal'].reduce(
    (total, key) => total + Number(events?.[key] ?? 0),
    0,
  );
}

const evidencePath = process.argv[2];
if (!evidencePath) {
  throw new Error('usage: node certification/evidence/validate-soak.mjs <soak.jsonl>');
}

const evidence = readFileSync(evidencePath);
const rows = evidence
  .toString('utf8')
  .split(/\r?\n/u)
  .filter((line) => line.trim() !== '')
  .map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new SyntaxError(`invalid JSONL at line ${index + 1}`, { cause: error });
    }
  });

assert.ok(rows.length >= 3, 'soak evidence must contain start, samples, and final records');
const starts = rows.filter((row) => row.type === 'soak-start');
const samples = rows.filter((row) => row.type === 'soak-sample');
const finals = rows.filter((row) => row.type === 'soak-final');
assert.equal(starts.length, 1, 'soak evidence must contain exactly one start record');
assert.equal(finals.length, 1, 'soak evidence must contain exactly one final record');
assert.equal(rows[0], starts[0], 'soak start must be the first record');
assert.equal(rows.at(-1), finals[0], 'soak final must be the last record');
assert.ok(samples.length >= 2, 'soak evidence must contain at least two samples');

const start = starts[0];
const final = finals[0];
const expectedCandidate = process.env.CERT_EXPECTED_CANDIDATE ?? start.candidate;
assert.ok(expectedCandidate, 'candidate SHA is missing');
for (const row of rows) {
  if (row.candidate !== undefined) {
    assert.equal(row.candidate, expectedCandidate, 'candidate SHA changed within the evidence');
  }
}

const expectedDuration = integerEnv('CERT_EXPECTED_DURATION_SECONDS', start.durationSeconds);
assert.equal(start.durationSeconds, expectedDuration, 'unexpected requested soak duration');
assert.ok(Number.isSafeInteger(start.sampleSeconds) && start.sampleSeconds > 0, 'invalid sample period');
assert.ok(final.elapsedSeconds >= expectedDuration, 'soak ended before its requested duration');

const minimumSamples = Math.max(2, Math.floor(expectedDuration / start.sampleSeconds) - 1);
assert.ok(
  samples.length >= minimumSamples,
  `insufficient samples: expected at least ${minimumSamples}, got ${samples.length}`,
);

let previousElapsed = 0;
let previousActiveEvents = -1;
let previousUserEvents = -1;
const queueLimit = integerEnv('CERT_STREAM_QUEUE_LIMIT', 4_096);
for (const [index, sample] of samples.entries()) {
  assert.ok(sample.elapsedSeconds > previousElapsed, `sample ${index + 1}: elapsed time is not monotonic`);
  previousElapsed = sample.elapsedSeconds;
  assert.equal(sample.pendingTags, 2, `sample ${index + 1}: expected two live listener tags`);
  assert.ok(sample.queuedReplies?.active < queueLimit, `sample ${index + 1}: ACTIVE queue saturated`);
  assert.ok(sample.queuedReplies?.users < queueLimit, `sample ${index + 1}: USERS queue saturated`);
  assertDiagnosticsClean(sample.diagnostics, `sample ${index + 1}`);
  assert.equal(
    sample.runtime?.eventLoopDelay?.exceeds ?? 0,
    0,
    `sample ${index + 1}: event-loop delay monitor exceeded its threshold`,
  );

  const activeEvents = eventTotal(sample.events?.active);
  const userEvents = eventTotal(sample.events?.users);
  assert.ok(activeEvents >= previousActiveEvents, `sample ${index + 1}: ACTIVE counters regressed`);
  assert.ok(userEvents >= previousUserEvents, `sample ${index + 1}: USERS counters regressed`);
  previousActiveEvents = activeEvents;
  previousUserEvents = userEvents;
}

assert.equal(final.status, 'PASS', 'final soak status is not PASS');
assert.equal(final.pendingTags, 0, 'final pendingTags must be zero');
assert.equal(final.queuedReplies?.active, 0, 'final ACTIVE queue must be empty');
assert.equal(final.queuedReplies?.users, 0, 'final USERS queue must be empty');
assertDiagnosticsClean(final.diagnostics, 'final');

const slopeLimits = {
  rss: integerEnv('CERT_MAX_RSS_SLOPE_BYTES_PER_HOUR', 16 * 1024 * 1024),
  heapUsed: integerEnv('CERT_MAX_HEAP_SLOPE_BYTES_PER_HOUR', 2 * 1024 * 1024),
  external: integerEnv('CERT_MAX_EXTERNAL_SLOPE_BYTES_PER_HOUR', 1024 * 1024),
  arrayBuffers: integerEnv('CERT_MAX_ARRAYBUFFER_SLOPE_BYTES_PER_HOUR', 1024 * 1024),
};
const growthLimits = {
  rss: integerEnv('CERT_MAX_RSS_GROWTH_BYTES', 128 * 1024 * 1024),
  heapUsed: integerEnv('CERT_MAX_HEAP_GROWTH_BYTES', 32 * 1024 * 1024),
  external: integerEnv('CERT_MAX_EXTERNAL_GROWTH_BYTES', 32 * 1024 * 1024),
  arrayBuffers: integerEnv('CERT_MAX_ARRAYBUFFER_GROWTH_BYTES', 16 * 1024 * 1024),
};

const memorySlopeBytesPerHour = {};
for (const key of Object.keys(slopeLimits)) {
  const slope = linearSlopePerHour(samples, (sample) => sample.memory[key]);
  memorySlopeBytesPerHour[key] = Math.round(slope);
  assert.ok(slope <= slopeLimits[key], `${key} slope exceeds certification limit`);
  assert.ok((final.memoryDelta?.[key] ?? 0) <= growthLimits[key], `${key} growth exceeds certification limit`);
}

const report = {
  evidence: evidencePath,
  evidenceSha256: createHash('sha256').update(evidence).digest('hex'),
  candidate: expectedCandidate,
  routerOSVersion: start.routerOSVersion,
  requestedDurationSeconds: expectedDuration,
  finalElapsedSeconds: final.elapsedSeconds,
  samples: samples.length,
  finalEvents: {
    active: final.activeEvents,
    users: final.userEvents,
  },
  memorySlopeBytesPerHour,
  finalMemoryDelta: final.memoryDelta,
  status: 'PASS',
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
