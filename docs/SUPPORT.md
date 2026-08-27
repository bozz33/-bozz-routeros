# Support matrix

## v0.1.0 claim

| Component | Status |
| --- | --- |
| Node.js 24.19.0 | certified build/runtime |
| Node.js newer than 24.19.0 | supported by `engines`; certification starts at 24.19.0 |
| ESM import | supported |
| CommonJS `require()` | not supported |
| RouterOS 7.24.1 Binary API | certified target |
| Other RouterOS releases | protocol-compatible use may work, but not certified by v0.1.0 |
| TCP API | supported; real TANDA gate |
| TLS/API-SSL | supported; synthetic CA/hostname/SNI gate; real gate required for deployments that use it |
| RouterOS REST API | out of scope |
| Browser/Deno/Bun | out of scope |

The narrow RouterOS claim is intentional. Raw commands and the dynamic API are forward-compatible by design, but compatibility is not called certification until the real-device matrix passes.

## Application boundary

The SDK does not promise automatic retry safety for mutations, business idempotency, distributed ownership, Redis projection, or multi-socket orchestration. Those belong to the consuming application.
