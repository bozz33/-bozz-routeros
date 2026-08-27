# API reference

All public symbols are exported from `@bozz/routeros`.

## `RouterOSClient`

```ts
new RouterOSClient(options: RouterOSClientOptions)
```

Important options:

| Option | Meaning |
| --- | --- |
| `host`, `port` | RouterOS API endpoint; defaults are 8728 TCP and 8729 TLS |
| `kind` | `tcp` or `tls` |
| `username`, `password` | optional automatic login credentials |
| `connectTimeoutMs` | transport connection deadline |
| `commandTimeoutMs` | default command terminal-reply deadline |
| `cancelTimeoutMs` | hard deadline for both cancel and target listener lifecycles |
| `keepAlive*`, `noDelay` | native Node socket controls |
| `tls` | Node `tls.connect()` options except host/port |
| `decoder` | maximum word/sentence buffering limits |
| `streamMaxQueuedReplies` | bounded listener queue size; default 4096 |
| `streamOverflowPolicy` | `error` or `drop-oldest`; default `error` |

Properties: `connected`, `authenticated`, and `pendingTags`.

Methods:

- `connect(signal?)` — connect and automatically log in when constructor credentials exist;
- `login(username, password, signal?)` — explicit login;
- `execute(command, options?)` — return the complete tagged command result;
- `print(menuOrPrintCommand, options?)` — return only record attributes;
- `listen(menuOrListenCommand, options?)` — return a bounded `RouterOSStream`;
- `close()` — close transport and settle local pending work.

## Command options

`attributes` encode normal RouterOS words such as `=name=value`. `apiAttributes` encode API words such as `.tag`; the SDK owns the command tag. `queries` are ordered `?` words.

`kind` controls failure semantics: `read`, `write`, `control`, or conservative `auto`. It does not grant permissions or change the RouterOS command.

`execute()` returns:

```ts
interface RouterOSCommandResult {
  tag: string;
  records: readonly Record<string, string>[];
  empty: boolean;
  traps: readonly RouterOSTrapReply[];
  done: RouterOSDoneReply;
}
```

## `RouterOSStream`

Properties: `tag`, `closed`, `queuedReplies`.

Methods:

- `nextReply(timeoutMs?, signal?)`;
- `cancel(signal?)`;
- async iteration through `for await`.

The signal passed to `cancel()` bounds only the caller wait. RouterOS-side cleanup continues independently.

## Queries

`routerOSQuery()` returns an ordered builder with `has`, `missing`, `equals`, `lessThan`, `greaterThan`, `and`, `or`, `not`, `operations`, `raw`, `clear`, and `toWords`.

## Dynamic API

`createRouterOSApi(client)` exposes arbitrary property paths and the methods `execute`, `print`, `getall`, `listen`, `add`, `set`, `remove`, and `path`. Dynamic nodes are intentionally not thenable.

## Reconnect supervision

`RouterOSConnectionSupervisor` manages one client. `start()` resolves after the first online state, `stop()` terminates supervision, and `snapshot()` returns state, bigint generation, attempt/reconnect counters, and timestamps.

Reconnect policy options: `initialDelayMs`, `maxDelayMs`, `multiplier`, `jitter`, `maxAttempts`, and `resetAfterStableMs`.

## Runtime monitor

`RouterOSRuntimeHealthMonitor` exposes `start`, `snapshot`, `reset`, and `stop`. Snapshots contain event-loop utilization/delay and libuv activity without adding a metrics dependency.

## Errors

All errors extend `RouterOSError`. Public specializations include protocol, connection, timeout, cancellation, authentication, stream overflow, trap, fatal, and ambiguous-write errors. Use `instanceof`; do not branch on message text.

## Events

The client emits `connected`, `disconnected`, `reply`, `orphanReply`, `protocolError`, and `transportFault`. The supervisor emits lifecycle events including `state`, `online`, `offline`, `connectFailure`, `retryScheduled`, `stable`, and `fault`.

See the generated TypeScript declarations for the exact structural payloads of the installed version.
