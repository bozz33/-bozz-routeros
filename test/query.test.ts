import assert from 'node:assert/strict';
import test from 'node:test';
import { routerOSQuery } from '../src/index.js';

test('query builder reproduces official ether-or-vlan example in order', () => {
  const words = routerOSQuery()
    .equals('type', 'ether')
    .equals('type', 'vlan')
    .or()
    .toWords();

  assert.deepEqual(words, ['?type=ether', '?type=vlan', '?#|']);
});

test('query builder reproduces official non-empty comment example', () => {
  assert.deepEqual(routerOSQuery().greaterThan('comment', '').toWords(), ['?>comment=']);
});

test('query builder reproduces official not(distance>1 and gateway=x) example', () => {
  const words = routerOSQuery()
    .greaterThan('distance', 1)
    .equals('gateway', '172.16.1.1')
    .operations('&!')
    .toWords();

  assert.deepEqual(words, ['?>distance=1', '?gateway=172.16.1.1', '?#&!']);
});

test('query builder supports existence, absence, comparisons, booleans and raw future grammar', () => {
  const words = routerOSQuery()
    .has('comment')
    .missing('dynamic')
    .lessThan('distance', 10)
    .equals('disabled', false)
    .raw('?#0')
    .toWords();

  assert.deepEqual(words, [
    '?comment',
    '?-dynamic',
    '?<distance=10',
    '?disabled=no',
    '?#0',
  ]);
});

test('query builder rejects malformed property and operation words', () => {
  assert.throws(() => routerOSQuery().equals('', 'x'), TypeError);
  assert.throws(() => routerOSQuery().equals('name=value', 'x'), TypeError);
  assert.throws(() => routerOSQuery().operations(''), TypeError);
  assert.throws(() => routerOSQuery().operations('~'), TypeError);
  assert.throws(() => routerOSQuery().raw('type=ether'), TypeError);
});

test('toWords returns a detached immutable snapshot', () => {
  const query = routerOSQuery().equals('type', 'ether');
  const first = query.toWords();
  query.equals('running', true);

  assert.deepEqual(first, ['?type=ether']);
  assert.deepEqual(query.toWords(), ['?type=ether', '?running=yes']);
  assert.throws(() => (first as string[]).push('?disabled=no'), TypeError);
});
