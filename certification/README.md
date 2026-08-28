# @bozz/routeros RC2 certification

This directory is certification tooling only. It is intentionally developed on `cert/rc2` so the SDK candidate remains immutable.

## Immutable candidate

- SDK ref: `rc/v0.1.0-rc2`
- SDK commit: `8a3cd500aa5013577ca1f8179c916dc7807cf392`
- Node: `24.19.0`
- npm: `11.17.0`
- package-lock SHA-256: `99e743ef9f97c10d487a45852e2e191d8b6d99d94265211d0b7c60ee51012311`
- expected tarball: `bozz-routeros-0.0.0-dev.tgz`
- expected tarball SHA-256: `343ce993318cd44e383162a25fdb0a0e7cf40bb0c0aaf3304d57826995e896c5`

The certification process must fail if any of these invariants changes.

Current evidence and remaining gates are tracked in [`STATUS.md`](STATUS.md).
The diagnosed CHR reboot-boundary defect and its corrected acceptance rule are
recorded in [`CHR-REBOOT-FINDING.md`](CHR-REBOOT-FINDING.md).
The host-by-host execution sequence is documented in [`RUNBOOK.md`](RUNBOOK.md).
The complete copy/paste handoff for the external operator is in
[`ASSISTANT-PROMPT.md`](ASSISTANT-PROMPT.md).

## Layers

1. `container/` certifies the exact SDK package in a disposable Node environment.
2. `chr/` prepares a disposable RouterOS CHR QEMU/KVM VM and records image/runtime identity.
3. The public real-RouterOS harness runs read-only conformance against CHR.
4. Network interruption and CHR reboot validate real reconnect behavior.
5. Physical HotSpot session events are certified on the operator-controlled personal Wi-Fi; the existing TANDA evidence is retained without new TANDA actions.

## Rules

- Never install the candidate into `bozzcenter-gateway` for certification.
- Never store RouterOS passwords, private keys, or tokens in this repository or generated reports.
- Prefer anonymous file descriptors or tmpfs-mounted secret files over persistent environment files.
- All reports must identify SDK SHA, tarball SHA-256, Node/npm versions, RouterOS version, VM/image identity, and test result.
- CHR must run as a VM. Docker containers are used only for the Node certification client.
- Destructive RouterOS tests are forbidden on production sessions.
