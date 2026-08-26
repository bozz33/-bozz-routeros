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
- No BOZZ business concepts in the core package.
- Conformance tests against RouterOS CHR and real RouterOS devices before stable release.

## Runtime

Node.js `>=24.19.0`.

The minimum is deliberate: Node 24.19 adds the keepalive controls used by the transport for `TCP_KEEPIDLE`, `TCP_KEEPINTVL`, and `TCP_KEEPCNT`.

## Example

```ts
import { RouterOSClient } from '@bozz/routeros';

const client = new RouterOSClient({
  host: '192.168.88.1',
  username: 'api-user',
  password: 'secret',
});

await client.connect();

const resources = await client.print('/system/resource', {
  apiAttributes: {
    '.proplist': ['uptime', 'cpu-load', 'version'],
  },
});

const stream = await client.listen('/interface');
for await (const reply of stream) {
  if (reply.type === 're') console.log(reply.attributes);
}
```

Raw RouterOS access is intentional: callers can use new menus and commands without waiting for a package release. Typed helpers can be layered on top without restricting the protocol surface.

## Layers

```text
src/
├── codec/       # RouterOS word-length and sentence encoding/decoding
├── protocol/    # replies, tags, command state machines
├── transport/   # native TCP/TLS socket lifecycle
├── client/      # login, execute, print, listen, cancel
├── supervisor/  # reconnect/backoff/health primitives (next phase)
├── observability/
└── errors/
```

## Upstream base and references

The initial binary framing/streaming implementation is adapted from the Apache-2.0 `SourceRegistry/mikrotik-client` project and then hardened/refactored. The pinned upstream baseline is recorded in `NOTICE`.

`@fibercom/routeros-api` 2.0.0 is used as a comparative functional/reference implementation for streaming, fragmented decoding, tagged concurrency, TLS, retries, and legacy compatibility.

When implementations disagree, MikroTik's official RouterOS API documentation is authoritative. Node.js official documentation is authoritative for runtime/socket behavior.

## Status

Pre-release architecture and protocol implementation. **Not production-ready yet.**

Before a stable release the project must pass strict TypeScript/CI, mock protocol tests, fragmentation/resource-limit tests, CHR and real RouterOS conformance, long-running listen tests, reconnect/reboot/network-loss tests, socket/tag/memory leak tests, and TLS validation tests.
