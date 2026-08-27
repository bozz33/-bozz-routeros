import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countReply,
  isRouterOSDeadReply,
  newEventCounters,
} from './common.mjs';

function reply(type, dead) {
  return {
    type,
    attributes: dead === undefined ? {} : { '.dead': dead },
  };
}

test('recognizes RouterOS dead markers observed as true or yes', () => {
  assert.equal(isRouterOSDeadReply(reply('re', 'true')), true);
  assert.equal(isRouterOSDeadReply(reply('re', 'yes')), true);
});

test('rejects non-dead values and non-record replies', () => {
  for (const value of ['false', 'no', '1', 'TRUE', '']) {
    assert.equal(isRouterOSDeadReply(reply('re', value)), false);
  }
  assert.equal(isRouterOSDeadReply(reply('re')), false);
  assert.equal(isRouterOSDeadReply(reply('done', 'true')), false);
});

test('event counters count both accepted dead marker encodings', () => {
  const counters = newEventCounters();
  countReply(counters, reply('re', 'true'));
  countReply(counters, reply('re', 'yes'));
  countReply(counters, reply('re', 'false'));
  countReply(counters, reply('empty'));

  assert.deepEqual(counters, {
    re: 3,
    empty: 1,
    trap: 0,
    done: 0,
    fatal: 0,
    dead: 2,
  });
});
