#!/bin/sh
set -eu

CHR_VERSION="${CHR_VERSION:-7.24.1}"
WORKDIR="${1:-./.certification/chr-$CHR_VERSION}"
OVERLAY="$WORKDIR/chr-$CHR_VERSION-overlay.qcow2"
API_PORT="${CHR_HOST_API_PORT:-18728}"
SSH_PORT="${CHR_HOST_SSH_PORT:-12222}"

command -v qemu-system-x86_64 >/dev/null

if [ ! -c /dev/kvm ]; then
  echo 'ERROR: /dev/kvm is required for the CHR certification VM.' >&2
  exit 1
fi

if [ ! -f "$OVERLAY" ]; then
  echo "ERROR: missing overlay: $OVERLAY" >&2
  echo "Run certification/chr/prepare-image.sh first." >&2
  exit 1
fi

cat <<EOF
Starting disposable RouterOS CHR $CHR_VERSION
Host API port: 127.0.0.1:$API_PORT -> guest:8728
Host SSH port: 127.0.0.1:$SSH_PORT -> guest:22

On first boot, use the CHR console to secure/configure the LAB VM.
The base image remains read-only; all changes are confined to the qcow2 overlay.
EOF

exec qemu-system-x86_64 \
  -name "bozz-routeros-chr-$CHR_VERSION" \
  -enable-kvm \
  -cpu host \
  -smp 2 \
  -m 1024 \
  -drive "file=$OVERLAY,if=virtio,format=qcow2,cache=none" \
  -netdev "user,id=net0,hostfwd=tcp:127.0.0.1:$API_PORT-:8728,hostfwd=tcp:127.0.0.1:$SSH_PORT-:22" \
  -device virtio-net-pci,netdev=net0 \
  -nographic \
  -no-reboot
