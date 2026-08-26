# @bozz/routeros

Modern, protocol-correct RouterOS Binary API SDK for Node.js and TypeScript.

`@bozz/routeros` is a general-purpose RouterOS SDK. It is **not** coupled to BOZZ-CENTER, HotSpot vouchers, Redis, accounting, or any application-specific workflow.

The implementation is derived in part from the RouterOS core of `@sourceregistry/mikrotik-client` (Apache-2.0; exact upstream baseline documented in `NOTICE`) and is independently hardened against the current MikroTik RouterOS API specification. `@fibercom/routeros-api` is used as a comparative implementation reference. The current MikroTik and Node.js official documentation remain the normative sources.

## Current maturity

The SDK core is **feature-complete for the planned v0 binary-API scope**, with CI covering protocol correctness, transport, TLS, concurrency, cancellation, stress, soak, packaging, and runtime observability.

It is **not yet production-certified**. Production certification still requires the opt-in conformance suite to pass against real RouterOS CHR and the target RouterOS stable environment (including TANDA RouterOS 7.24.1 for BOZZ-CENTER integration).

## Runtime

- Node.js `>=24.19.0`
- ESM
- strict TypeScript
- no runtime dependencies

## Core capabilities

- RouterOS binary word/sentence codec
- incremental decoder safe across fragmented or coalesced TCP data
- bounded decoder resource limits
- TCP and API-SSL/TLS transports using native Node.js `net` / `tls`
- TLS CA and server-identity verification
- DNS SNI handling without sending IP literals as SNI
- TCP keepalive and `TCP_NODELAY`
- strict replies: `!re`, `!empty`, `!trap`, `!done`, `!fatal`
- `!empty` remains non-terminal until matching `!done`
- concurrent commands multiplexed by `.tag`
- orphan/late replies reported without crashing the process
- raw commands for future RouterOS compatibility
- ordered RouterOS query-word builder
- dynamic menu API overlay for ergonomic access to arbitrary RouterOS paths
- `listen` as bounded `AsyncIterable`
- `.dead=yes` exposed unchanged to consumers
- strict `/cancel` lifecycle tracking target-tag and cancel-tag independently
- caller `AbortSignal` cannot suppress remote cancel cleanup
- hard cancellation timeout quarantines/closes ambiguous connections
- write timeouts/disconnects classified as ambiguous when RouterOS may have applied the mutation
- optional reconnect supervisor with exponential backoff and jitter
- Node runtime/event-loop observability

## Quick start

```ts
import { RouterOSClient, routerOSQuery } from '@bozz/routeros';

const client = new RouterOSClient({
  host: 'router.example.net',
  username: 'api-user',
  password: process.env.ROUTEROS_PASSWORD ?? '',
  kind: 'tls',
});

await client.connect();

const resources = await client.print('/system/resource', {
  attributes: { '.proplist': 'uptime,version,cpu-load' },
});

const active = await client.print('/ip/hotspot/active', {
  attributes: { '.proplist': '.id,user,uptime' },
  queries: routerOSQuery().equals('user', 'alice').toWords(),
});

const stream = await client.listen('/interface', {
  attributes: { '.proplist': '.id,name,running,disabled' },
});

for await (const reply of stream) {
  console.log(reply);
  // Stop through another condition/task when appropriate:
  // await stream.cancel();
}
```

The raw client deliberately does not encode business semantics. RouterOS menus added in future RouterOS releases can be addressed immediately through raw paths without waiting for a new SDK version.

## Dynamic API

The optional dynamic overlay builds RouterOS paths without maintaining a hard-coded menu tree:

```ts
import { RouterOSClient, createRouterOSApi } from '@bozz/routeros';

const client = new RouterOSClient({ host: '10.0.0.1', username: 'admin' });
const api = createRouterOSApi(client);

const identity = await api.system.identity.print();
const users = await api.ip.hotspot.user.print({
  attributes: { '.proplist': '.id,name,uptime,limit-uptime' },
});
```

## Safety model for writes

Read commands may generally be retried after a known pre-dispatch failure. Mutations are different: if command bytes may have reached RouterOS but the terminal acknowledgement was lost, the SDK raises `RouterOSAmbiguousWriteError` instead of claiming a safe failure.

Applications should perform **read-after-write reconciliation** before deciding whether an ambiguous mutation can be retried.

## Cancellation model

MikroTik documents `/cancel` as a separate command with its own `.tag`; the command being cancelled is identified by the normal `=tag` argument. The SDK therefore tracks the two lifecycles independently and does not release the target listener until RouterOS finishes it.

If a caller abandons `stream.cancel(signal)`, the caller's wait can be cancelled but the RouterOS cleanup continues. If RouterOS does not complete the cancellation lifecycle before `cancelTimeoutMs`, the connection is closed because remote state is unknowable.

## Conformance and stress

The CI suite includes:

- fragmented/coalesced binary frames
- official query-word examples
- `!empty -> !done`
- `!trap` / `!fatal`
- orphan/late replies
- 256 concurrent out-of-order tagged commands
- concurrent listeners and normal commands on one connection
- TLS trust and hostname verification
- stream overflow cleanup
- caller-abort vs remote `/cancel` isolation
- hard cancel timeout quarantine
- 10,000 command lifecycles with zero tag leakage
- 1,000 listen/cancel lifecycles with zero tag leakage
- 20,000-event listen soak
- reconnect supervisor tests
- npm package assembly

See [`docs/CONFORMANCE.md`](docs/CONFORMANCE.md) for real RouterOS validation.

## Architecture boundary

A consuming application may choose one or many connections. For example, BOZZ-CENTER will compose separate CONTROL, ACTIVE-LISTEN, and USER-LISTEN connections above this SDK for failure isolation. That topology is **not imposed by `@bozz/routeros`**.

## Normative references

- MikroTik RouterOS API: https://manual.mikrotik.com/docs/developer-guides/api/
- Node.js `net`: https://nodejs.org/api/net.html
- Node.js `tls`: https://nodejs.org/api/tls.html
- Node.js `events`: https://nodejs.org/api/events.html

## License and upstream attribution

Apache-2.0. See `LICENSE` and `NOTICE`.
