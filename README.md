# @bozz/routeros

A modern, protocol-correct RouterOS Binary API SDK for Node.js and TypeScript.

`@bozz/routeros` is intentionally generic. It does not know about BOZZ-CENTER, vouchers, tenants, Redis, accounting, or any application-specific workflow. BOZZ-CENTER is only one intended consumer.

## Design goals

- RouterOS 7.x Binary API first, aligned with MikroTik's official protocol documentation.
- Strict reply lifecycle for `!re`, `!empty`, `!trap`, `!done`, and `!fatal`.
- Correct `.tag` multiplexing and `/cancel` lifecycle.
- Long-lived `listen` streams with bounded buffering, AsyncIterator, and AbortSignal support.
- Native TCP/TLS transport built on official Node.js primitives.
- TLS certificate verification enabled by default.
- TCP keepalive and TCP_NODELAY for long-lived sockets.
- Empty results, late tags, and orphan replies must never be misclassified as RouterOS outages.
- Unknown raw commands remain usable; the SDK must not lag behind future RouterOS menus.
- Reads and writes have different failure semantics. Writes are never blindly replayed after ambiguous acknowledgement loss.
- Generic reconnect supervision with exponential backoff, jitter, connection generations, and stable-period reset.
- Optional zero-dependency Node runtime health diagnostics for event-loop delay/utilization and libuv activity.
- No BOZZ business concepts in the core package.
- Conformance tests against RouterOS CHR and real RouterOS devices before stable release.

## Runtime

Node.js `>=24.19.0`.

The minimum is deliberate: Node 24.19 adds the keepalive controls used by the transport for `TCP_KEEPIDLE`, `TCP_KEEPINTVL`, and `TCP_KEEPCNT`.

The development/release-candidate toolchain is pinned to npm `11.17.0` through `packageManager`, and dependency installation is locked with `package-lock.json` + `npm ci`.

## Example

```ts
import {
  RouterOSClient,
  RouterOSConnectionSupervisor,
  RouterOSRuntimeHealthMonitor,
} from '@bozz/routeros';

const client = new RouterOSClient({
  host: '192.168.88.1',
  username: 'api-user',
  password: 'secret',
});

await client.connect();

const resources = await client.print('/system/resource', {
  attributes: {
    '.proplist': ['uptime', 'cpu-load', 'version'],
  },
});

const stream = await client.listen('/interface');
for await (const reply of stream) {
  if (reply.type === 're') console.log(reply.attributes);
}
```

`attributes: { '.proplist': [...] }` intentionally produces the RouterOS binary API word `=.proplist=...`. The API attribute namespace (words beginning directly with `.`) is separate; MikroTik currently documents `.tag` there.

Raw RouterOS access is intentional: callers can use new menus and commands without waiting for a package release. Typed helpers can be layered on top without restricting the protocol surface.

### Optional reconnect supervision

```ts
const supervisor = new RouterOSConnectionSupervisor({
  client,
  reconnect: {
    initialDelayMs: 250,
    maxDelayMs: 30_000,
    multiplier: 2,
    jitter: 'full',
    resetAfterStableMs: 30_000,
  },
});

await supervisor.start();
console.log(supervisor.snapshot());
```

The supervisor manages one generic client. Applications that want isolated control/realtime sockets compose multiple supervisors above the SDK rather than encoding application-specific roles in the package.

### Optional Node runtime diagnostics

```ts
const runtime = new RouterOSRuntimeHealthMonitor({ resolutionMs: 20 });
runtime.start();

const health = runtime.snapshot();
console.log(health.eventLoopUtilization, health.eventLoopDelay.p99Ms);
```

The runtime monitor has no Prometheus/OpenTelemetry dependency. It reports native Node.js event-loop and libuv diagnostics; the application decides how to export them.

## Layers

```text
src/
├── codec/          # RouterOS word-length and sentence encoding/decoding
├── protocol/       # replies, tags, command state machines
├── transport/      # native TCP/TLS socket lifecycle
├── client/         # login, execute, print, listen, cancel
├── supervisor/     # reconnect/backoff/jitter/generation primitives
├── observability/  # optional Node runtime health diagnostics
└── errors/
```

## Upstream base and references

The initial binary framing/streaming implementation is adapted from the Apache-2.0 `SourceRegistry/mikrotik-client` project and then hardened/refactored. The pinned upstream baseline is recorded in `NOTICE`.

`@fibercom/routeros-api` 2.0.0 is used as a comparative functional/reference implementation for streaming, fragmented decoding, tagged concurrency, TLS, retries, and legacy compatibility.

When implementations disagree, MikroTik's official RouterOS API documentation is authoritative. Node.js official documentation is authoritative for runtime/socket behavior.

## Status

The planned v0 SDK core is **feature-complete and software-gate complete**, but **not production-certified yet**.

Release Candidate 1 was built from commit `2f67c90762718b3678cff9b553a95adbf95ce457` using Node `24.19.0` and npm `11.17.0`. Its reproducible CI passed strict typecheck, all 47 generic tests, stress/soak gates, build, `npm pack --dry-run`, actual `npm pack`, and installation/import from the produced tarball in a clean consumer project.

RC1 tarball SHA-256: `343ce993318cd44e383162a25fdb0a0e7cf40bb0c0aaf3304d57826995e896c5`.

Stable release is blocked only on real RouterOS certification: CHR first, then supported physical/current RouterOS targets. See `docs/CONFORMANCE.md` and `docs/RELEASE.md`.
