# Architecture v0

## Scope

`@bozz/routeros` is a RouterOS Binary API protocol and transport library. It does not know about BOZZ vouchers, tenants, accounting, Redis, Laravel, or application-specific workflows.

## Core invariants

1. `!empty` is a successful empty observation, not an exception and not a terminal lifecycle event by itself.
2. `!trap` is accumulated for the command tag and the tag remains alive until `!done`.
3. `!done` is the normal terminal reply for a command tag.
4. `!fatal` terminates the connection and rejects all pending work.
5. Late/orphan replies never crash the host process.
6. `/cancel` has its own command tag; cancellation of a listener and completion of the cancel command are tracked independently.
7. Reads and writes have different retry semantics. A write whose acknowledgement is lost becomes ambiguous until state reconciliation proves the outcome.
8. Protocol parsing and business policy are separated.

## Package layers

```text
codec
  word length encoding
  word encoding
  streaming sentence decoder

protocol
  reply parser
  TagRegistry
  CommandStateMachine
  ListenStateMachine
  cancellation lifecycle

transport
  TcpTransport
  TlsTransport
  keepalive / no-delay
  socket lifecycle

client
  connect/login
  execute/print
  listen/cancel

supervisor
  reconnect/backoff/jitter
  control vs realtime connection roles
  generation tracking

observability
  lifecycle hooks and metrics contracts
```

## Intended BOZZ deployment topology

The package is capable of arbitrary tagged multiplexing, but BOZZ-CENTER will intentionally isolate failure domains using three logical connections per router:

```text
RouterOS
├── CONTROL       -> print/add/set/remove/targeted reads
├── ACTIVE LISTEN -> /ip/hotspot/active/listen
└── USER LISTEN   -> /ip/hotspot/user/listen
```

This topology belongs to the BOZZ Gateway, not to the protocol package itself.

## Bootstrap/reconciliation pattern

Realtime consumers should use:

```text
open LISTEN
-> buffer events
-> take fresh CONTROL snapshot
-> establish a new generation
-> publish snapshot
-> replay buffered events
-> enter LIVE mode
```

This prevents the snapshot/listen race where a RouterOS change occurs between the two operations.

## Compatibility strategy

The project will maintain a RouterOS conformance suite against:

- CHR test versions,
- latest supported RouterOS 7.x,
- physical BOZZ routers such as TANDA before production promotion.

SourceRegistry/mikrotik-client is the initial implementation reference/base. Fibercom/routeros-api is a comparative oracle/benchmark. MikroTik's official RouterOS API documentation remains authoritative when implementations disagree.
