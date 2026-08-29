import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const candidate = '0123456789abcdef0123456789abcdef01234567';

function cleanDiagnostics() {
  return { orphanReplies: 0, protocolErrors: 0, transportFaults: 0, disconnects: 0 };
}

function counters(re) {
  return { re, empty: 0, trap: 0, done: 0, fatal: 0, dead: 0 };
}

function fixtureRows() {
  const rows = [{
    type: 'soak-start',
    candidate,
    routerOSVersion: '7.24.1 (stable)',
    durationSeconds: 60,
    sampleSeconds: 10,
  }];

  for (let elapsedSeconds = 10; elapsedSeconds <= 60; elapsedSeconds += 10) {
    rows.push({
      type: 'soak-sample',
      elapsedSeconds,
      memory: {
        rss: 50_000_000 + elapsedSeconds,
        heapUsed: 5_000_000 + elapsedSeconds,
        external: 1_000_000,
        arrayBuffers: 100_000,
      },
      pendingTags: 2,
      queuedReplies: { active: 0, users: 0 },
      events: {
        active: counters(elapsedSeconds / 10),
        users: counters(elapsedSeconds / 10),
      },
      diagnostics: cleanDiagnostics(),
      runtime: { eventLoopDelay: { exceeds: 0 } },
    });
  }

  rows.push({
    type: 'soak-final',
    candidate,
    elapsedSeconds: 60,
    memoryDelta: { rss: 60, heapUsed: 60, external: 0, arrayBuffers: 0 },
    pendingTags: 0,
    queuedReplies: { active: 0, users: 0 },
    activeEvents: counters(6),
    userEvents: counters(6),
    diagnostics: cleanDiagnostics(),
    status: 'PASS',
  });

  return rows;
}

function runValidator(rows) {
  const directory = mkdtempSync(join(tmpdir(), 'bozz-routeros-soak-'));
  const evidence = join(directory, 'soak.jsonl');
  writeFileSync(evidence, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, { mode: 0o600 });
  return spawnSync(
    process.execPath,
    ['certification/evidence/validate-soak.mjs', evidence],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        CERT_EXPECTED_CANDIDATE: candidate,
        CERT_EXPECTED_DURATION_SECONDS: '60',
      },
    },
  );
}

test('accepts complete clean soak evidence', () => {
  const result = runValidator(fixtureRows());
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'PASS');
});

test('rejects an orphan reply even when the producer wrote PASS', () => {
  const rows = fixtureRows();
  rows[2].diagnostics.orphanReplies = 1;
  const result = runValidator(rows);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /orphanReplies must be zero/u);
});

test('rejects incomplete terminal cleanup', () => {
  const rows = fixtureRows();
  rows.at(-1).pendingTags = 1;
  const result = runValidator(rows);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /final pendingTags must be zero/u);
});

test('rejects an interrupted soak without a terminal record', () => {
  const rows = fixtureRows();
  rows.pop();
  const result = runValidator(rows);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exactly one final record/u);
});

test('rejects a clean final record that ends before the requested duration', () => {
  const rows = fixtureRows();
  rows.at(-1).elapsedSeconds = 59;
  const result = runValidator(rows);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ended before its requested duration/u);
});
