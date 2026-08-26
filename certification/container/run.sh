#!/bin/sh
set -eu

EXPECTED_NODE='v24.19.0'
EXPECTED_NPM='11.17.0'
EXPECTED_LOCK_SHA256='99e743ef9f97c10d487a45852e2e191d8b6d99d94265211d0b7c60ee51012311'
EXPECTED_TARBALL='bozz-routeros-0.0.0-dev.tgz'
EXPECTED_TARBALL_SHA256='343ce993318cd44e383162a25fdb0a0e7cf40bb0c0aaf3304d57826995e896c5'

ACTUAL_NODE="$(node --version)"
ACTUAL_NPM="$(npm --version)"
[ "$ACTUAL_NODE" = "$EXPECTED_NODE" ]
[ "$ACTUAL_NPM" = "$EXPECTED_NPM" ]

echo "$EXPECTED_LOCK_SHA256  package-lock.json" | sha256sum -c -
test -d node_modules

# Defend against host/checkout umask differences before every package build.
sh certification/container/normalize-package-modes.sh

rm -rf dist .artifacts
npm run typecheck
npm test
npm run test:stress
npm run build
test -f dist/index.js
test -f dist/index.d.ts
npm pack --dry-run

mkdir -p .artifacts
TARBALL="$(npm pack --pack-destination .artifacts --silent | tail -n 1)"
[ "$TARBALL" = "$EXPECTED_TARBALL" ]
echo "$EXPECTED_TARBALL_SHA256  .artifacts/$TARBALL" | sha256sum -c -
node scripts/consumer-smoke.mjs ".artifacts/$TARBALL"

node -e '
const report = {
  candidate: "2f67c90762718b3678cff9b553a95adbf95ce457",
  node: process.version,
  npm: "11.17.0",
  tarballSha256: "343ce993318cd44e383162a25fdb0a0e7cf40bb0c0aaf3304d57826995e896c5",
  memory: process.memoryUsage(),
  platform: process.platform,
  arch: process.arch,
  status: "PASS"
};
console.log(JSON.stringify(report));
'
