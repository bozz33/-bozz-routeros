import assert from 'node:assert/strict';

const UNIT_DURATION = /^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;
const CLOCK_DURATION = /^(?:(\d+)w)?(?:(\d+)d)?(\d+):([0-5]\d):([0-5]\d)$/;

export function parseRouterOSDurationSeconds(value) {
  assert.equal(typeof value, 'string', 'RouterOS duration must be a string');
  const raw = value.trim();
  assert.ok(raw, 'RouterOS duration must not be empty');

  const clock = CLOCK_DURATION.exec(raw);
  if (clock) {
    const [, weeks = '0', days = '0', hours, minutes, seconds] = clock;
    return (Number(weeks) * 604_800)
      + (Number(days) * 86_400)
      + (Number(hours) * 3_600)
      + (Number(minutes) * 60)
      + Number(seconds);
  }

  const units = UNIT_DURATION.exec(raw);
  assert.ok(units && units.slice(1).some((part) => part !== undefined),
    `Unsupported RouterOS duration: ${value}`);
  const [, weeks = '0', days = '0', hours = '0', minutes = '0', seconds = '0'] = units;
  assert.ok(Number(minutes) < 60 && Number(seconds) < 60,
    `Unsupported RouterOS duration: ${value}`);
  return (Number(weeks) * 604_800)
    + (Number(days) * 86_400)
    + (Number(hours) * 3_600)
    + (Number(minutes) * 60)
    + Number(seconds);
}

export function validateRebootEvidence({
  initialUptime,
  recoveredUptime,
  minimumInitialUptimeSeconds,
}) {
  const initialUptimeSeconds = parseRouterOSDurationSeconds(initialUptime);
  const recoveredUptimeSeconds = parseRouterOSDurationSeconds(recoveredUptime);

  assert.ok(
    initialUptimeSeconds >= minimumInitialUptimeSeconds,
    `Initial RouterOS uptime ${initialUptimeSeconds}s is below the required ${minimumInitialUptimeSeconds}s`,
  );
  assert.ok(
    recoveredUptimeSeconds < initialUptimeSeconds,
    `RouterOS uptime did not decrease across reset (${initialUptimeSeconds}s -> ${recoveredUptimeSeconds}s)`,
  );

  return {
    initialUptime,
    initialUptimeSeconds,
    recoveredUptime,
    recoveredUptimeSeconds,
    rebootObserved: true,
  };
}
