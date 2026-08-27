#!/bin/sh
set -eu

CHR_VERSION="${CHR_VERSION:-7.24.1}"
WORKDIR="${1:-./.certification/chr-$CHR_VERSION}"
DOWNLOAD_URL="https://download.mikrotik.com/routeros/$CHR_VERSION/chr-$CHR_VERSION.img.zip"
ZIP="$WORKDIR/chr-$CHR_VERSION.img.zip"
BASE="$WORKDIR/chr-$CHR_VERSION.img"
OVERLAY="$WORKDIR/chr-$CHR_VERSION-overlay.qcow2"
EXPECTED_ARCHIVE_SHA256="${CHR_ARCHIVE_SHA256:-}"

command -v curl >/dev/null
command -v unzip >/dev/null
command -v qemu-img >/dev/null

mkdir -p "$WORKDIR"

if [ ! -f "$ZIP" ]; then
  curl --fail --location --proto '=https' --tlsv1.2 "$DOWNLOAD_URL" --output "$ZIP"
fi

ARCHIVE_SHA256="$(sha256sum "$ZIP" | awk '{print $1}')"
printf '%s  %s\n' "$ARCHIVE_SHA256" "$ZIP" | tee "$WORKDIR/chr-archive.sha256"

if [ -n "$EXPECTED_ARCHIVE_SHA256" ]; then
  printf '%s  %s\n' "$EXPECTED_ARCHIVE_SHA256" "$ZIP" | sha256sum -c -
  ARCHIVE_VERIFICATION='pinned-match'
else
  ARCHIVE_VERIFICATION='recorded-only'
  echo 'WARNING: CHR_ARCHIVE_SHA256 is not set; archive identity is recorded but not pre-pinned.' >&2
  echo 'A release certification run must repeat with an independently approved digest.' >&2
fi

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
archive_sha256=$ARCHIVE_SHA256
archive_verification=$ARCHIVE_VERIFICATION
EOF

printf '\nPrepared disposable CHR overlay:\n%s\n' "$OVERLAY"
