# @bozz/routeros certification status

Updated: 2026-08-29

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
- dead-marker tooling SHA: `9c7e539b6e7ad565165905ab514b29d674479608`
- CHR reboot-gate tooling SHA: `7de10fcc171d350fa31e0f18b9f41296afee1192`
- latest GitHub Actions run: `33139359730` — PASS
- latest certification image ID: `sha256:f2f4920799b16192fc45941bfcd1dfe822782a009fea2c62a811e11e19b26979`

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
- certification helper/evidence tests: 12/12 PASS

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

## Physical LAB 24-hour soak attempts

The first 24-hour attempt was reported as interrupted on 2026-08-29 at
11:53:06Z after `elapsedSeconds=56161` (approximately 15 h 36), with 936
samples and container exit code 1. The terminal error was `read ETIMEDOUT`.
Because the run did not reach 86,400 seconds and did not produce an admissible
clean final record, gate D is FAIL/incomplete even though the preceding resource
and protocol diagnostics were clean.

The operator also reported that an independent BOZZ-CENTER production sidecar,
using another RouterOS library and connection pool, timed out against the same
router in the same one-minute window. That correlation supports an external
network-path interruption and does not demonstrate an SDK defect. It does not
convert the incomplete run into PASS. The raw interrupted evidence, full hashes,
container inspection, and sidecar extract remain pending import and audit.

A fresh attempt was reported started at 2026-08-29 11:55:29Z with dead-marker
tooling `9c7e539b6e7ad565165905ab514b29d674479608`. Its result remains pending.
Runs must never be concatenated or resumed to manufacture a 24-hour window.


## Physical LAB dead-marker finding

A diagnostic capture on the personal RouterOS 7.24.1 target observed the raw
Binary API words:

```text
["!re",".tag=L2","=.id=*D3080A0A","=.dead=true"]
```

The SDK correctly exposed the raw `.dead` value and required no candidate
change. Tooling SHA `9f831dedc47bc8879027ab9aa732e3b6266d8dfc`
incorrectly required only `yes`, so E/F evidence from that tooling is rejected.
Tooling SHA `9c7e539b6e7ad565165905ab514b29d674479608`
centralizes the marker predicate, accepts exactly `true` or `yes`, records the
raw value in E/F reports, and adds three helper tests. Its immutable container
gate passed 6/6 certification tests, 47/47 SDK tests, and 5/5 stress tests.

Existing A/C evidence from tooling `9f831ded…` remains admissible because those
gates do not assert the dead-marker value. A future uninterrupted D soak from
that tooling would also be technically admissible for the same reason, but the
reported first 24-hour attempt was interrupted and is therefore not admissible.
The soak validator uses record counts, tag/queue cleanup, diagnostics, duration,
and memory/resource slopes; the informational `dead` subcounter is not a PASS
criterion. E and F must use the corrected tooling.

## CHR evidence finding and repaired gate

The committed diagnostic archive `certification/rc2.zip` has SHA-256
`551ccff842badd422c60b319191a0c8c2c732fa0e1a23d796314a8ef439f61cf`.
Its manifest validates all 14 evidence files. It records CHR conformance G and
network reconnect H as technically PASS under tooling `9f831ded…`, but those
two gates must be replayed under the latest tooling to remove the formal SHA
deviation.

Section I was correctly reported BLOCKED, not failed: `run-qemu.sh` used
`-no-reboot`, while QEMU SLIRP `hostfwd` kept the host-side TCP connection
established across the guest reset. The SDK was connected to a live QEMU TCP
peer and therefore correctly emitted no disconnect.

Tooling `7de10fcc…` removes `-no-reboot` and makes I a composed, fail-closed
gate. QMP must report the host `RESET` event, recovered RouterOS uptime must be
lower than initial uptime, the dedicated TCP proxy must cause a real client
disconnect, the supervisor generation must advance, and a post-reconnect
RouterOS command must succeed. Either a proxy cut without a reboot or a reboot
without an SDK reconnect fails.

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
- [ ] physical RouterOS 7.24.1 24-hour ACTIVE/USERS soak (attempt 1 incomplete; fresh attempt reported in progress)
- [ ] CHR 7.24.1 conformance replay on tooling `7de10fcc…`
- [ ] CHR client-network interruption replay on tooling `7de10fcc…`
- [ ] CHR hypervisor reboot + forced client-path interruption on tooling `7de10fcc…`
- [ ] import and audit the reported physical LAB `.dead=true/yes` PASS evidence
- [ ] import and audit the reported LAB-only `active/remove` PASS evidence

The existing TANDA two-hour evidence remains valid. No additional TANDA action is part of this certification plan. The personal target must be RouterOS 7.24.1 and pass the physical 24-hour and client gates; otherwise certification stops pending a separate maintenance decision. TANDA reboot remains forbidden without a separately approved maintenance window. No BOZZ-CENTER production source or runtime is changed by this certification branch.

## Verdict

- feature-complete SDK core: PASS
- RC2 software gate: PASS locally and in the immutable Docker gate
- TANDA conformance and 2-hour soak: PASS
- full real certification: NOT YET COMPLETE
- stable release / merge / npm publish: BLOCKED until every required gate above passes
