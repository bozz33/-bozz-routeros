import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isQmpActionComplete,
  observeQmpActionMessage,
  validateQmpActionObservation,
} from './qmp-protocol.mjs';

const resetEvent = {
  event: 'RESET',
  data: { guest: false, reason: 'host-qmp-system-reset' },
  timestamp: { seconds: 1_777_000_000, microseconds: 42 },
};

test('collects the reset response and RESET event in either order', () => {
  for (const messages of [
    [{ return: {} }, resetEvent],
    [resetEvent, { return: {} }],
  ]) {
    let observation = {};
    for (const message of messages) {
      observation = observeQmpActionMessage(observation, message);
    }
    assert.equal(isQmpActionComplete(observation, 'reset'), true);
    assert.deepEqual(validateQmpActionObservation(observation, 'reset'), {
      guest: false,
      reason: 'host-qmp-system-reset',
      timestamp: { seconds: 1_777_000_000, microseconds: 42 },
    });
  }
});

test('does not accept command success without a host reset event', () => {
  const responseOnly = observeQmpActionMessage({}, { return: {} });
  assert.equal(isQmpActionComplete(responseOnly, 'reset'), false);

  const guestReset = observeQmpActionMessage(responseOnly, {
    ...resetEvent,
    data: { guest: true, reason: 'guest-reset' },
  });
  assert.throws(() => validateQmpActionObservation(guestReset, 'reset'),
    /not triggered by the host/);
});

test('fails immediately on a QMP command error', () => {
  const observation = observeQmpActionMessage({}, {
    error: { class: 'CommandNotFound', desc: 'system_reset' },
  });
  assert.equal(isQmpActionComplete(observation, 'reset'), true);
  assert.throws(() => validateQmpActionObservation(observation, 'reset'),
    /QMP reset failed/);
});
