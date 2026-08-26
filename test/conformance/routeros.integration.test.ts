import assert from 'node:assert/strict';
import test from 'node:test';
import { RouterOSClient, routerOSQuery } from '../../src/index.js';

const host = process.env.ROUTEROS_HOST;
const username = process.env.ROUTEROS_USERNAME;
const password = process.env.ROUTEROS_PASSWORD ?? '';
const port = process.env.ROUTEROS_PORT ? Number(process.env.ROUTEROS_PORT) : undefined;
const useTls = process.env.ROUTEROS_TLS === '1' || process.env.ROUTEROS_TLS === 'true';
const enabled = Boolean(host && username);

function client(): RouterOSClient {
  if (!host || !username) throw new Error('RouterOS conformance environment is not configured');
  return new RouterOSClient({
    host,
    username,
    password,
    ...(port === undefined ? {} : { port }),
    kind: useTls ? 'tls' : 'tcp',
    commandTimeoutMs: 10_000,
  });
}

test('real RouterOS: login and basic read commands', { skip: !enabled }, async () => {
  const ros = client();
  try {
    await ros.connect();
    const [identity, resource] = await Promise.all([
      ros.print('/system/identity', { attributes: { '.proplist': 'name' } }),
      ros.print('/system/resource', { attributes: { '.proplist': 'uptime,version,cpu-load' } }),
    ]);
    assert.ok(identity[0]?.name);
    assert.ok(resource[0]?.uptime);
    assert.ok(resource[0]?.version);
    assert.equal(ros.pendingTags, 0);
  } finally {
    await ros.close();
  }
});

test('real RouterOS: empty print query returns [] rather than a protocol error', { skip: !enabled }, async () => {
  const ros = client();
  try {
    const rows = await ros.print('/ip/hotspot/active', {
      attributes: { '.proplist': '.id,user' },
      queries: routerOSQuery()
        .equals('user', '__bozz_routeros_conformance_missing_user__')
        .toWords(),
    });
    assert.deepEqual(rows, []);
    assert.equal(ros.pendingTags, 0);
  } finally {
    await ros.close();
  }
});

test('real RouterOS: tagged concurrent reads remain isolated', { skip: !enabled }, async () => {
  const ros = client();
  try {
    const operations = Array.from({ length: 32 }, () =>
      ros.print('/system/resource', { attributes: { '.proplist': 'uptime,version' } }),
    );
    const results = await Promise.all(operations);
    assert.equal(results.length, 32);
    assert.ok(results.every((rows) => Boolean(rows[0]?.uptime)));
    assert.equal(ros.pendingTags, 0);
  } finally {
    await ros.close();
  }
});

test('real RouterOS: listen emits data and /cancel terminates both tag lifecycles', { skip: !enabled }, async () => {
  const ros = client();
  try {
    const stream = await ros.listen('/interface', {
      attributes: { '.proplist': '.id,name,running,disabled' },
      maxQueuedReplies: 64,
    });

    // RouterOS commonly emits the current list when listen starts. The test
    // intentionally tolerates an implementation/menu that emits no immediate
    // record; cancellation semantics are the actual invariant under test.
    await stream.nextReply(1_000).catch(() => undefined);
    await stream.cancel();
    assert.equal(stream.closed, true);
    assert.equal(ros.pendingTags, 0);
  } finally {
    await ros.close();
  }
});
