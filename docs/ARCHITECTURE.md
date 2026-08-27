# Architecture

`@bozz/routeros` is a general-purpose RouterOS Binary API SDK. Application-specific topology and business logic live above the package.

## Layering

```text
Application / orchestration
        │
        ▼
RouterOSClient / dynamic API
        │
        ├── command state machines
        ├── TagRegistry
        ├── listen/cancel streams
        └── conservative write semantics
        │
        ▼
SocketTransport
        │
        ├── TCP (8728 by default)
        └── TLS/API-SSL (8729 by default)
        │
        ▼
RouterOS
```

Optional generic facilities sit beside the client:

```text
RouterOSConnectionSupervisor
  └── reconnect / backoff / jitter / generation

RouterOSRuntimeHealthMonitor
  └── Node.js event-loop/libuv diagnostics
```

## Protocol authority

The MikroTik RouterOS API manual is normative for:

- binary word/sentence framing;
- commands and attribute/query words;
- `.tag` multiplexing;
- `!re`, `!empty`, `!trap`, `!done`, `!fatal` replies;
- `listen` behavior;
- `/cancel` semantics.

Node.js official documentation is normative for TCP, TLS, AbortSignal integration, EventEmitter behavior, and runtime diagnostics.

Third-party SDKs are references, not authorities. The framing/streaming base was adapted from `SourceRegistry/mikrotik-client`; `@fibercom/routeros-api` is used as a comparative implementation reference.

## Command lifecycle

A normal tagged command remains registered until its terminal RouterOS lifecycle is known.

```text
SENT
 ├── !re     -> accumulate record
 ├── !empty  -> mark empty; keep tag
 ├── !trap   -> accumulate trap; keep tag
 ├── !done   -> terminal; resolve/reject and release tag
 └── !fatal  -> connection-fatal; fail pending work and close
```

`!empty` is explicitly **not** treated as an error and does **not** release the tag before `!done`.

## Long-running streams

`listen()` returns a bounded `AsyncIterable` stream. Buffer overflow can either drop the oldest record or fail the stream, depending on policy. In error mode, remote `/cancel` cleanup is initiated automatically before the local stream is closed.

The raw reply is exposed without boolean coercion. For example, RouterOS
7.24.1 has been observed emitting `=.dead=true`, while earlier examples or
other contexts may use `=.dead=yes`. The SDK preserves whichever string was on
the wire and does not impose business semantics on that field.

## Strict cancellation

MikroTik documents `/cancel` as a separate command:

```text
/listen              .tag=L1
/cancel =tag=L1      .tag=X1
```

The SDK tracks `L1` and `X1` independently. The cancellation lifecycle is complete only when both the cancel command and the target command have reached terminal state.

A caller's `AbortSignal` controls only how long that caller waits for cancellation. It does not suppress or abort the RouterOS `/cancel` cleanup once cancellation has been requested.

If the lifecycle does not become knowable before `cancelTimeoutMs`, the API connection is quarantined/closed. Closing is safer than continuing to use a socket on which an unknown long-running command may still exist.

## Writes and ambiguity

RouterOS mutations are not automatically replayed after acknowledgement loss. If command bytes may have reached RouterOS but the terminal reply was not observed, the SDK reports `RouterOSAmbiguousWriteError`.

Consumers should perform read-after-write reconciliation before retrying.

## Transport

The transport uses native Node.js primitives only:

- `node:net`;
- `node:tls`;
- TCP keepalive;
- `TCP_NODELAY`;
- serialized physical writes with protocol-level concurrency through `.tag`;
- TLS verification by default;
- DNS SNI only when appropriate.

Abort handling uses Node.js `events.addAbortListener()` through an internal idempotent helper so third-party `stopImmediatePropagation()` cannot suppress library cleanup.

## Reconnect supervisor

The optional supervisor owns one generic client and provides:

- exponential backoff;
- none/full/equal jitter;
- reconnect counters;
- connection generations;
- stable-period backoff reset;
- lifecycle events/snapshots.

The SDK does **not** prescribe how many connections an application uses.

For example, BOZZ-CENTER can compose three isolated supervised clients for CONTROL, ACTIVE-LISTEN, and USER-LISTEN. Another application can use one multiplexed connection or a different topology entirely.

## Snapshot/listen race avoidance

Applications that require an authoritative live mirror can compose the SDK using:

```text
open LISTEN
-> buffer events
-> take fresh CONTROL snapshot
-> establish generation N
-> publish snapshot
-> replay buffered events
-> enter LIVE mode
```

This pattern belongs to the consuming application's orchestration layer, not to the protocol SDK.

## Conformance

See `CONFORMANCE.md`.

The v0 core is feature-complete when local CI is green. Production certification additionally requires successful real RouterOS conformance against CHR and target RouterOS releases.
