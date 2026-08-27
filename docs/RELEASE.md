# v0 Release Readiness

## Feature-complete core

The planned v0 binary-API core is considered feature-complete when all of the following are implemented and CI-green:

- binary word/sentence codec;
- incremental fragmented/coalesced decoding;
- decoder resource limits;
- TCP and TLS/API-SSL transport;
- RouterOS login;
- raw execute/print;
- query builder;
- dynamic menu overlay;
- `.tag` multiplexing;
- strict `!re` / `!empty` / `!trap` / `!done` / `!fatal` lifecycle;
- bounded `listen` streams;
- strict dual-tag `/cancel` lifecycle;
- AbortSignal-safe cleanup;
- ambiguous-write classification;
- reconnect supervisor;
- runtime observability;
- stress/soak tests;
- npm package assembly validation.

At the current v0 development head, these implementation gates are present.

## Production certification

Production certification is a separate gate and is **not** implied by feature completeness.

Required before a stable production release:

- [ ] real RouterOS CHR conformance passes;
- [ ] current target RouterOS stable conformance passes;
- [ ] real `!empty` behavior confirmed;
- [ ] real concurrent tagged commands confirmed;
- [ ] real `listen` and a raw `.dead` marker observed where applicable;
- [ ] real `/cancel` dual-tag lifecycle confirmed;
- [ ] API-SSL/TLS validated if used by the deployment;
- [ ] actual network interruption/reconnect test passes;
- [ ] RouterOS restart/reconnect test passes;
- [ ] extended real-network listen soak shows no material tag/socket/memory leak;
- [ ] release candidate package installed and exercised from a clean consumer project.

## BOZZ-CENTER integration certification

These are application integration gates, not public SDK requirements:

- [ ] TANDA RouterOS 7.24.1 conformance suite passes;
- [ ] `/ip/hotspot/active/listen` real stream passes;
- [ ] `/ip/hotspot/user/listen` real stream passes;
- [ ] logout marker confirmed (`.dead=true` on RouterOS 7.24.1; harness also
      accepts `yes`) and correlated by exact RouterOS `.id`;
- [ ] `!empty` no longer produces gateway HTTP 500;
- [ ] active/remove does not create unknown/orphan-tag failures;
- [ ] Gateway CONTROL / ACTIVE-LISTEN / USER-LISTEN topology validated;
- [ ] Redis projection/reconciliation tests pass;
- [ ] existing webhook/accounting behavior remains unchanged.

A stable SDK release should not be blocked by BOZZ-specific features, but BOZZ-CENTER production migration must not occur before the BOZZ integration gates pass.
