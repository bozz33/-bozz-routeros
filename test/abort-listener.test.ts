import assert from 'node:assert/strict';
import test from 'node:test';
import { addSafeAbortListener } from '../src/util/abort-listener.js';

test('safe abort listener cannot be suppressed by stopImmediatePropagation', () => {
  const controller = new AbortController();
  let called = 0;

  controller.signal.addEventListener('abort', (event) => {
    event.stopImmediatePropagation();
  });

  const dispose = addSafeAbortListener(controller.signal, () => {
    called += 1;
  });

  controller.abort();
  assert.equal(called, 1);
  dispose();
  dispose();
});

test('safe abort listener can be removed before abort', () => {
  const controller = new AbortController();
  let called = 0;
  const dispose = addSafeAbortListener(controller.signal, () => {
    called += 1;
  });

  dispose();
  controller.abort();
  assert.equal(called, 0);
});
