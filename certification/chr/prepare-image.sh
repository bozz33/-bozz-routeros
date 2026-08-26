#!/bin/sh
set -eu

CHR_VERSION="${CHR_VERSION:-7.24.1}"
WORKDIR="${1:-./.certification/chr-$CHR_VERSION}"
DOWNLOAD_URL="https://download.mikrotik.com/routeros/$CHR_VERSION/chr-$CHR_VERSION.img.zip"
ZIP="$WORKDIR/chr-$CHR_VERSION.img.zip"
BASE="$WORKDIR/chr-$CHR_VERSION.img"
OVERLAY="$WORKDIR/chr-$CHR_VERSION-overlay.qcow2"

command -v curl >/dev/null
command -v unzip >/dev/null
command -v qemu-img >/dev/null

mkdir -p "$WORKDIR"

if [ ! -f "$ZIP" ]; then
  curl --fail --location --proto '=https' --tlsv1.2 "$DOWNLOAD_URL" --output "$ZIP"
fi

sha256sum "$ZIP" | tee "$WORKDIR/chr-archive.sha256"

if [ ! -f "$BASE" ]; then
  unzip -p "$ZIP" > "$BASE"
fi

sha256sum "$BASE" | tee "$WORKDIR/chr-raw.sha256"
chmod 0444 "$BASE"

rm -f "$OVERLAY"
qemu-img create -f qcow2 -F raw -b "$(readlink -f "$BASE")" "$OVERLAY"
qemu-img info "$OVERLAY"

cat > "$WORKDIR/metadata.txt" <<EOF
chr_version=$CHR_VERSION
download_url=$DOWNLOAD_URL
base_image=$(readlink -f "$BASE")
overlay=$(readlink -f "$OVERLAY")
created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

printf '\nPrepared disposable CHR overlay:\n%s\n' "$OVERLAY"
