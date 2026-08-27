# CHR certification VM

This lab targets RouterOS CHR `7.24.1` first. CHR is a full RouterOS virtual machine; it is not run as a Docker container.

Official references:

- CHR installation: https://manual.mikrotik.com/docs/getting-started/installation-and-upgrade/install/chr-installation/
- RouterOS API: https://manual.mikrotik.com/docs/developer-guides/api/
- Router users/groups: https://manual.mikrotik.com/docs/authentication-authorization-accounting/user/

## 1. Prepare a disposable disk

On a Linux KVM/QEMU host with `curl`, `unzip`, `qemu-img`, and `qemu-system-x86_64` installed:

```bash
export CHR_ARCHIVE_SHA256='<independently-approved-archive-sha256>'
sh certification/chr/prepare-image.sh
```

The script downloads the official MikroTik CHR RAW archive over HTTPS, records SHA-256 for both archive and extracted RAW image, marks the RAW image read-only, and creates a disposable qcow2 overlay.

For exploratory preparation, the script can record an unpinned digest and emits a warning. A release certification run must set `CHR_ARCHIVE_SHA256` to an independently approved digest and must record `archive_verification=pinned-match` in `metadata.txt`.

Do not reuse a modified overlay for a new certification run. Recreate it from the base image.

## 2. Boot

```bash
sh certification/chr/run-qemu.sh
```

Defaults:

- 2 vCPU;
- 1024 MiB RAM;
- VirtIO disk and NIC;
- host `127.0.0.1:18728` forwarded to guest API port `8728`;
- host `127.0.0.1:12222` forwarded to guest SSH port `22`;
- a local QMP Unix socket under the disposable work directory;
- console attached to the current terminal.

## 3. Initial LAB configuration

The official CHR image initially uses `admin` with no password. Secure it immediately from the VM console.

Create only the permissions needed by the public read-only conformance harness. Example RouterOS commands:

```routeros
/password

/ip dhcp-client add interface=ether1 disabled=no

/user group add name=bozz-conformance policy=read,api
/user add name=conformance group=bozz-conformance password="USE-A-RANDOM-LAB-SECRET"

/ip service set api disabled=no port=8728 address=10.0.2.2/32
/ip service print
/ip dhcp-client print detail
/system resource print
```

QEMU user-mode networking presents the host side to the guest through the virtual network gateway. Verify the actual addresses in the LAB before relying on the `address=` restriction.

Do not add `write`, `policy`, `sensitive`, or `reboot` to the conformance account for read-only certification.

## 4. Run public conformance

From the Node certification environment, point the public harness at the forwarded API port:

```bash
export ROUTEROS_HOST=127.0.0.1
export ROUTEROS_PORT=18728
export ROUTEROS_USERNAME=conformance
npm run test:conformance
```

Provide the password only to the process running the harness; do not put it in this repository, a Docker image, shell history, or reports.

## 5. Reboot/network gates

After baseline conformance passes:

1. keep a supervisor/client probe running;
2. put `certification/chaos/tcp-cut-proxy.mjs` between the probe and CHR;
3. send `SIGUSR1` to that dedicated proxy to close only its listener and TCP pairs, then let it restore itself;
4. verify reconnect/generation behavior;
5. reboot the CHR VM with `qmp-control.mjs ... reset` or from the VM console;
6. verify the client detects disconnect and recovers after RouterOS returns;
7. recreate the overlay after destructive/chaos work.

QMP is available only through the local Unix socket. The helper supports
`status`, `link-down`, `link-up`, and `reset`; it does not expose a TCP control
port and never targets a physical router.

The physical TANDA reboot is a separate BOZZ-CENTER integration gate and requires an explicit maintenance window.
