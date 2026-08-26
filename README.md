# @bozz/routeros

Modern, protocol-correct RouterOS Binary API transport for Node.js/TypeScript.

This repository is the protocol and transport foundation for BOZZ RouterOS integrations. It is intentionally independent from BOZZ-CENTER business logic.

## Design goals

- RouterOS Binary API first, aligned with MikroTik's official protocol documentation.
- Strict reply lifecycle for `!re`, `!empty`, `!trap`, `!done`, and `!fatal`.
- Correct `.tag` multiplexing and `/cancel` lifecycle.
- Long-lived `listen` streams with AsyncIterator and AbortSignal support.
- Dedicated TCP/TLS transport built on official Node.js primitives.
- No RouterOS reply, late tag, socket race, or empty result may crash the host process.
- Read commands may be retried under explicit policy; writes are never blindly replayed.
- No BOZZ business concepts (voucher, accounting, Redis, tenant) in the core package.
- Conformance tests against RouterOS CHR and physical RouterOS devices before release.

## Target package

```text
@bozz/routeros
```

## Planned layers

```text
src/
├── codec/       # RouterOS word-length and sentence encoding/decoding
├── protocol/    # replies, tags, command state machines
├── transport/   # TCP/TLS sockets and lifecycle
├── client/      # execute/print/listen/cancel API
├── supervisor/  # reconnect/backoff/health primitives
├── observability/
└── errors/
```

## Project status

Architecture bootstrap in progress. No production use yet.

## Upstream research

The implementation is informed by MikroTik RouterOS official API documentation, Node.js official `net`, `tls`, `events`, and abort APIs, and comparative study of modern open-source RouterOS clients. Any source-derived code incorporated later will retain the applicable license and attribution.
