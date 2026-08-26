# @bozz/routeros RC1 certification

This directory is certification tooling only. It is intentionally developed on `cert/rc1` so the SDK candidate remains immutable.

## Immutable candidate

- SDK ref: `rc/v0.1.0-rc1`
- SDK commit: `2f67c90762718b3678cff9b553a95adbf95ce457`
- Node: `24.19.0`
- npm: `11.17.0`
- package-lock SHA-256: `99e743ef9f97c10d487a45852e2e191d8b6d99d94265211d0b7c60ee51012311`
- expected tarball: `bozz-routeros-0.0.0-dev.tgz`
- expected tarball SHA-256: `343ce993318cd44e383162a25fdb0a0e7cf40bb0c0aaf3304d57826995e896c5`

The certification process must fail if any of these invariants changes.

## Layers

1. `container/` certifies the exact SDK package in a disposable Node environment.
2. `chr/` prepares a disposable RouterOS CHR QEMU/KVM VM and records image/runtime identity.
3. The public real-RouterOS harness runs read-only conformance against CHR.
4. Network interruption and CHR reboot validate real reconnect behavior.
5. BOZZ-CENTER-specific TANDA tests are an external integration gate and do not alter the public SDK candidate.

## Rules

- Never install the candidate into `bozzcenter-gateway` for certification.
- Never store RouterOS passwords, private keys, or tokens in this repository or generated reports.
- Prefer anonymous file descriptors or tmpfs-mounted secret files over persistent environment files.
- All reports must identify SDK SHA, tarball SHA-256, Node/npm versions, RouterOS version, VM/image identity, and test result.
- CHR must run as a VM. Docker containers are used only for the Node certification client.
- Destructive RouterOS tests are forbidden on production sessions.
