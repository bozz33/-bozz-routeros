import assert from 'node:assert/strict';

export function observeQmpActionMessage(observation, message) {
  return {
    ...observation,
    ...(message.event === 'RESET' ? { resetEvent: message } : {}),
    ...(message.return !== undefined || message.error ? { result: message } : {}),
  };
}

export function isQmpActionComplete(observation, action) {
  if (!observation.result) return false;
  if (observation.result.error) return true;
  return action !== 'reset' || observation.resetEvent !== undefined;
}

export function validateQmpActionObservation(observation, action) {
  assert.ok(observation.result, 'QMP action returned no command result');
  if (observation.result.error) {
    throw new Error(`QMP ${action} failed: ${JSON.stringify(observation.result.error)}`);
  }

  if (action !== 'reset') return undefined;
  assert.ok(observation.resetEvent, 'QMP reset returned no RESET event');
  assert.equal(observation.resetEvent.data?.guest, false,
    'QMP RESET event was not triggered by the host');
  assert.equal(observation.resetEvent.data?.reason, 'host-qmp-system-reset',
    'QMP RESET event has an unexpected reason');

  return {
    guest: observation.resetEvent.data.guest,
    reason: observation.resetEvent.data.reason,
    timestamp: observation.resetEvent.timestamp,
  };
}
