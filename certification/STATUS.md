# @bozz/routeros certification status

Updated: 2026-08-27

## Candidate RC2

- SDK ref: `rc/v0.1.0-rc2`
- SDK SHA: `8a3cd500aa5013577ca1f8179c916dc7807cf392`
- parent RC1 SHA: `2f67c90762718b3678cff9b553a95adbf95ce457`
- candidate change: deterministic application-level producer window in the synthetic 20k-listen test only
- runtime/source/package payload change from RC1: none
- Node: `v24.19.0`
- npm: `11.17.0`
- package-lock SHA-256: `99e743ef9f97c10d487a45852e2e191d8b6d99d94265211d0b7c60ee51012311`
- normalized tarball SHA-256: `343ce993318cd44e383162a25fdb0a0e7cf40bb0c0aaf3304d57826995e896c5`
- tested certification tooling SHA: `94d31d33b47b362c0e8755a97974d3315507871f`
- GitHub Actions run: `33105010400` — PASS
- certification image ID: `sha256:f440082bc201c32c69f2b30ced57f433d07c66b4b2ee6a2037d15b38c3c6c407`

RC1 remains immutable. RC2 exists because the old synthetic listener producer could turn into an accidental unbounded burst: it failed 5/10 isolated repetitions and 3/10 combined stress repetitions on the pinned Node runtime. The corrected test passed 25/25 isolated repetitions and 10/10 combined stress repetitions before RC2 was frozen.

## RC2 software gate

- TypeScript strict: PASS
- generic tests: 47/47 PASS
- stress tests: 5/5 PASS
- 10k commands: PASS
- 1k listen/cancel: PASS
- 20k sustained listener events: PASS
- build: PASS
- package dry-run: PASS
- clean consumer install/import: PASS
- normalized tarball identity unchanged from RC1: PASS
- digest-pinned Docker gate: PASS
- evidence-validator tests: 3/3 PASS

## Real RouterOS evidence inherited by identical package payload

The real RouterOS runs below executed RC1, but RC2 produces the exact same public tarball SHA-256. RC2 changed only a non-published synthetic test. The real-device evidence is therefore reusable for the identical runtime artifact, while all new software and remaining real gates identify RC2 explicitly.

TANDA `TANDAPHARMA`, RouterOS `7.24.1 (stable)`:

- generic real conformance 4/4: PASS
- real `!empty`: PASS
- concurrent tagged reads: PASS
- `/interface/listen` then `/cancel`: PASS
- passive HotSpot harness, concurrency 64: PASS
- simultaneous ACTIVE/USERS listeners: PASS
- final pending/orphan/protocol/transport/disconnect counters: all zero
- 2-hour soak: PASS
- soak evidence SHA-256: `8750815697902ff75b574b1a61cda426e1b25a3f6487642b3aa623d27e0571ac`
- soak records: 1 start + 120 samples + 1 final
- final ACTIVE/USERS events: 57/57
- final pending tags and queues: all zero
- heap slope: approximately 0.12 MiB/hour
- external and ArrayBuffer slopes: flat
- RSS slope: approximately 4.44 MiB/hour; final RSS delta 9.81 MiB over 2 hours

The evidence passes `certification/evidence/validate-soak.mjs` with the default release thresholds.

## Initial support claim

- Node.js: `>=24.19.0`
- package module format: ESM
- runtime dependencies: none
- RouterOS certified target: `7.24.1 (stable)` Binary API
- transport certified on TANDA: TCP over the existing private WireGuard path
- API-SSL/TLS: synthetic end-to-end CA/hostname/SNI gates pass; a real API-SSL gate is required for any deployment that uses API-SSL
- other RouterOS versions: not certified by v0.1.0 until explicitly added to the matrix

## Pending release gates

- [x] digest-pinned RC2 Docker gate on GitHub Actions
- [ ] TANDA 24-hour ACTIVE/USERS soak
- [ ] CHR 7.24.1 conformance on a host exposing `/dev/kvm`
- [ ] CHR client-network interruption and reconnect
- [ ] CHR hypervisor reboot and reconnect
- [ ] physical LAB `.dead=yes` with a dedicated test client
- [ ] LAB-only `active/remove` with all destructive safeguards satisfied

TANDA reboot is not required for the public SDK release and remains forbidden without a separately approved maintenance window. No BOZZ-CENTER production source or runtime is changed by this certification branch.

## Verdict

- feature-complete SDK core: PASS
- RC2 software gate: PASS locally and in the immutable Docker gate
- TANDA conformance and 2-hour soak: PASS
- full real certification: NOT YET COMPLETE
- stable release / merge / npm publish: BLOCKED until every required gate above passes
