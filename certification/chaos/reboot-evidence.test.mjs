import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseRouterOSDurationSeconds,
  validateRebootEvidence,
} from './reboot-evidence.mjs';

test('parses RouterOS unit and clock duration encodings exactly', () => {
  assert.equal(parseRouterOSDurationSeconds('1w2d3h4m5s'), 788_645);
  assert.equal(parseRouterOSDurationSeconds('01:02:03'), 3_723);
  assert.equal(parseRouterOSDurationSeconds('2d01:02:03'), 176_523);
  assert.equal(parseRouterOSDurationSeconds('5m'), 300);
  assert.equal(parseRouterOSDurationSeconds('10s'), 10);
});

test('rejects malformed or ambiguous RouterOS durations', () => {
  for (const value of ['', '1h30', '1m70s', '1:2:3', 'uptime=5m']) {
    assert.throws(() => parseRouterOSDurationSeconds(value));
  }
});

test('accepts only evidence where RouterOS uptime decreased after reset', () => {
  assert.deepEqual(validateRebootEvidence({
    initialUptime: '5m',
    recoveredUptime: '10s',
    minimumInitialUptimeSeconds: 30,
  }), {
    initialUptime: '5m',
    initialUptimeSeconds: 300,
    recoveredUptime: '10s',
    recoveredUptimeSeconds: 10,
    rebootObserved: true,
  });

  assert.throws(() => validateRebootEvidence({
    initialUptime: '10s',
    recoveredUptime: '1s',
    minimumInitialUptimeSeconds: 30,
  }), /below the required/);
  assert.throws(() => validateRebootEvidence({
    initialUptime: '5m',
    recoveredUptime: '6m',
    minimumInitialUptimeSeconds: 30,
  }), /did not decrease/);
});
