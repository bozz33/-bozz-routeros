import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import type {
  RouterOSCommandOptions,
  RouterOSListenOptions,
  RouterOSStream,
} from '../src/client/types.js';
import type { RouterOSCommandResult } from '../src/protocol/reply.js';
import {
  RouterOSConnectionSupervisor,
  calculateReconnectDelay,
  normalizeReconnectPolicy,
  type RouterOSDisconnectedEvent,
  type RouterOSSupervisedClient,
} from '../src/supervisor/supervisor.js';

class FakeClient extends EventEmitter implements RouterOSSupervisedClient {
  public connected = false;
  public connectCalls = 0;
  public failuresBeforeSuccess = 0;

  public async connect(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason;
    this.connectCalls += 1;
    if (this.failuresBeforeSuccess > 0) {
      this.failuresBeforeSuccess -= 1;
      throw new Error('synthetic connect failure');
    }
    this.connected = true;
  }

  public async login(): Promise<void> {}

  public async execute(
    _command: string,
    _options?: RouterOSCommandOptions,
  ): Promise<RouterOSCommandResult> {
    throw new Error('not used by supervisor tests');
  }

  public async print(): Promise<readonly Record<string, string>[]> {
    throw new Error('not used by supervisor tests');
  }

  public async listen(
    _command: string,
    _options?: RouterOSListenOptions,
  ): Promise<RouterOSStream> {
    throw new Error('not used by supervisor tests');
  }

  public async close(): Promise<void> {
    this.connected = false;
  }

  public disconnect(error?: unknown): void {
    if (!this.connected) return;
    this.connected = false;
    const event: RouterOSDisconnectedEvent = {
      at: Date.now(),
      ...(error === undefined ? {} : { error }),
    };
    this.emit('disconnected', event);
  }
}

test('reconnect delay supports deterministic full and equal jitter', () => {
  const full = normalizeReconnectPolicy({
    initialDelayMs: 100,
    maxDelayMs: 1_000,
    multiplier: 2,
    jitter: 'full',
  });
  assert.equal(calculateReconnectDelay(full, 1, () => 0.5), 50);
  assert.equal(calculateReconnectDelay(full, 4, () => 0.5), 400);

  const equal = normalizeReconnectPolicy({
    initialDelayMs: 100,
    maxDelayMs: 1_000,
    multiplier: 2,
    jitter: 'equal',
  });
  assert.equal(calculateReconnectDelay(equal, 1, () => 0), 50);
  assert.equal(calculateReconnectDelay(equal, 1, () => 0.5), 75);
});

test('supervisor retries failed initial connects and resolves when online', async () => {
  const client = new FakeClient();
  client.failuresBeforeSuccess = 2;
  const supervisor = new RouterOSConnectionSupervisor({
    client,
    reconnect: {
      initialDelayMs: 1,
      maxDelayMs: 2,
      multiplier: 2,
      jitter: 'none',
      resetAfterStableMs: 1_000,
    },
  });

  try {
    await supervisor.start();
    assert.equal(client.connectCalls, 3);
    assert.equal(supervisor.state, 'online');
    assert.equal(supervisor.generation, 1n);
    assert.equal(supervisor.snapshot().consecutiveAttempts, 2);
  } finally {
    await supervisor.stop();
  }

  assert.equal(supervisor.state, 'stopped');
});

test('supervisor reconnects after a live connection is lost and advances generation', async () => {
  const client = new FakeClient();
  const supervisor = new RouterOSConnectionSupervisor({
    client,
    reconnect: {
      initialDelayMs: 1,
      maxDelayMs: 1,
      multiplier: 1,
      jitter: 'none',
      resetAfterStableMs: 10_000,
    },
  });

  try {
    await supervisor.start();
    assert.equal(supervisor.generation, 1n);

    const nextOnline = once(supervisor, 'online');
    client.disconnect(new Error('link lost'));
    await nextOnline;

    assert.equal(supervisor.generation, 2n);
    assert.equal(supervisor.snapshot().reconnectCount, 1);
    assert.equal(client.connectCalls, 2);
  } finally {
    await supervisor.stop();
  }
});

test('stable connection resets exponential-backoff history', async () => {
  const client = new FakeClient();
  const supervisor = new RouterOSConnectionSupervisor({
    client,
    reconnect: {
      initialDelayMs: 1,
      maxDelayMs: 10,
      multiplier: 2,
      jitter: 'none',
      resetAfterStableMs: 5,
    },
  });

  try {
    await supervisor.start();
    await once(supervisor, 'stable');
    assert.equal(supervisor.snapshot().consecutiveAttempts, 0);
  } finally {
    await supervisor.stop();
  }
});
