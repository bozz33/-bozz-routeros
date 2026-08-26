import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandStateMachine } from '../src/protocol/command-state-machine.js';
import type { RouterOSReply } from '../src/protocol/reply.js';

const reply = (type: RouterOSReply['type'], tag = 'B1', attributes: Record<string, string> = {}): RouterOSReply => ({
  type,
  tag,
  attributes,
  apiAttributes: { tag },
  raw: [`!${type}`, `.tag=${tag}`],
}) as RouterOSReply;

test('!empty does not terminate a command before !done', () => {
  const machine = new CommandStateMachine('B1');

  assert.equal(machine.accept(reply('empty')), undefined);
  assert.equal(machine.state, 'open');

  const result = machine.accept(reply('done'));
  assert.equal(machine.state, 'completed');
  assert.deepEqual(result?.records, []);
  assert.equal(result?.empty, true);
});

test('!re records accumulate until !done', () => {
  const machine = new CommandStateMachine('B1');

  machine.accept(reply('re', 'B1', { name: 'MESSIE@@@' }));
  const result = machine.accept(reply('done'));

  assert.deepEqual(result?.records, [{ name: 'MESSIE@@@' }]);
  assert.equal(result?.empty, false);
});

test('a reply for another tag is rejected by the command state machine', () => {
  const machine = new CommandStateMachine('B1');
  assert.throws(() => machine.accept(reply('re', 'B2')));
});
