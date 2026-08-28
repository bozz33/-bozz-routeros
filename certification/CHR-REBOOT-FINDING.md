# RC2 CHR reboot finding

## Evidence identity

- archive: `certification/rc2.zip`
- archive SHA-256: `551ccff842badd422c60b319191a0c8c2c732fa0e1a23d796314a8ef439f61cf`
- archive commit: `15290034cd60919d1dece354929bb80a88a78af4`
- manifest: 14/14 files validated
- SDK candidate: `8a3cd500aa5013577ca1f8179c916dc7807cf392`
- executed CHR tooling: `9f831dedc47bc8879027ab9aa732e3b6266d8dfc`
- repaired CHR tooling: `7de10fcc171d350fa31e0f18b9f41296afee1192`

## Finding

G (real CHR conformance) and H (forced client-network interruption) passed.
They used the old tooling SHA and therefore require a short formal replay with
the repaired image, even though the relevant executable files were unchanged.

I was BLOCKED by the harness, not failed by the SDK:

1. `run-qemu.sh` passed `-no-reboot`, which makes QEMU exit instead of
   rebooting the disposable guest.
2. After locally removing that option for diagnosis, QEMU SLIRP `hostfwd`
   preserved the host-side TCP pair across the guest reset. The SDK remained
   connected to a genuinely live QEMU peer, so emitting no disconnect was the
   correct transport behavior.

## Corrected acceptance rule

Section I now combines independent reboot and transport evidence:

- `run-qemu.sh` permits reset;
- QMP `system_reset` must produce a host `RESET` event with reason
  `host-qmp-system-reset`;
- RouterOS uptime is recorded before and after recovery and must decrease;
- a dedicated `tcp-cut-proxy` breaks the exact socket path seen by the SDK;
- the SDK must emit a disconnect;
- the supervisor must return online with a higher generation;
- a RouterOS command must succeed after recovery;
- orphan replies and protocol errors must remain zero.

A proxy cut without a RouterOS reboot cannot pass the uptime assertion. A
RouterOS reset without a real SDK-visible disconnect cannot pass the reconnect
assertions.

## Scope

This correction changes certification tooling only. It does not modify the
frozen SDK candidate, public package payload, BOZZ-CENTER, TANDA, or either
physical HotSpot.
