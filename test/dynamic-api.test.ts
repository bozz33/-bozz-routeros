import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  RouterOSClientLike,
  RouterOSCommandOptions,
  RouterOSListenOptions,
  RouterOSStream,
} from '../src/client/types.js';
import type { RouterOSCommandResult } from '../src/protocol/reply.js';
import { createRouterOSApi } from '../src/index.js';

class DummyStream implements RouterOSStream {
  public readonly tag = 'dummy';
  public readonly closed = false;
  public readonly queuedReplies = 0;
  public async nextReply(): Promise<undefined> {
    return undefined;
  }
  public async cancel(): Promise<void> {}
  public async *[Symbol.asyncIterator](): AsyncIterator<never> {}
}

interface RecordedCall {
  readonly kind: 'execute' | 'print' | 'listen';
  readonly command: string;
  readonly options: RouterOSCommandOptions | RouterOSListenOptions;
}

class RecordingClient implements RouterOSClientLike {
  public readonly calls: RecordedCall[] = [];
  public connected = true;

  public async connect(): Promise<void> {}
  public async login(): Promise<void> {}
  public async close(): Promise<void> {}

  public async execute(
    command: string,
    options: RouterOSCommandOptions = {},
  ): Promise<RouterOSCommandResult> {
    this.calls.push({ kind: 'execute', command, options });
    return {
      tag: 'C1',
      records: [],
      empty: false,
      traps: [],
      done: {
        type: 'done',
        tag: 'C1',
        attributes: {},
        apiAttributes: { tag: 'C1' },
        raw: ['!done', '.tag=C1'],
      },
    };
  }

  public async print(
    command: string,
    options: RouterOSCommandOptions = {},
  ): Promise<readonly Record<string, string>[]> {
    this.calls.push({ kind: 'print', command, options });
    return [{ path: command }];
  }

  public async listen(
    command: string,
    options: RouterOSListenOptions = {},
  ): Promise<RouterOSStream> {
    this.calls.push({ kind: 'listen', command, options });
    return new DummyStream();
  }
}

test('dynamic API maps arbitrary property chains to RouterOS menu paths', async () => {
  const client = new RecordingClient();
  const api = createRouterOSApi(client);

  assert.equal(api.ip.hotspot.user.$path, '/ip/hotspot/user');
  const rows = await api.ip.hotspot.user.print({
    attributes: { '.proplist': ['name', 'uptime'] },
  });

  assert.deepEqual(rows, [{ path: '/ip/hotspot/user' }]);
  assert.equal(client.calls[0]?.command, '/ip/hotspot/user');
});

test('dynamic write helpers default conservatively to write semantics', async () => {
  const client = new RecordingClient();
  const api = createRouterOSApi(client);

  await api.routing.bgp.connection.add({ name: 'peer-a' });
  await api.interface.set({ '.id': '*1', disabled: true });
  await api.ip.address.remove({ '.id': '*2' });

  assert.deepEqual(
    client.calls.map((call) => [call.command, call.options.kind]),
    [
      ['/routing/bgp/connection/add', 'write'],
      ['/interface/set', 'write'],
      ['/ip/address/remove', 'write'],
    ],
  );
});

test('dynamic API supports future unknown menus, raw actions and explicit path segments', async () => {
  const client = new RecordingClient();
  const api = createRouterOSApi(client);

  await api.future['new-menu'].widget.execute('frobnicate', {
    attributes: { mode: 'safe' },
  });
  await api.path('interface/wireguard/peers').listen();
  await api.path('print').path('future').execute('/system/resource/print');

  assert.deepEqual(
    client.calls.map((call) => call.command),
    [
      '/future/new-menu/widget/frobnicate',
      '/interface/wireguard/peers',
      '/system/resource/print',
    ],
  );
});

test('dynamic API nodes are not thenables and can be safely awaited/passed through Promise machinery', async () => {
  const api = createRouterOSApi(new RecordingClient());
  const resolved = await api.ip.hotspot;
  assert.equal(resolved, api.ip.hotspot);
});

test('dynamic API refuses path-dependent operations at root', () => {
  const api = createRouterOSApi(new RecordingClient());
  assert.throws(() => api.print(), TypeError);
  assert.throws(() => api.listen(), TypeError);
  assert.throws(() => api.add(), TypeError);
});
