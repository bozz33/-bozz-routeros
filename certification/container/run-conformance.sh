#!/bin/sh
set -eu

: "${ROUTEROS_HOST:?ROUTEROS_HOST is required}"
: "${ROUTEROS_USERNAME:?ROUTEROS_USERNAME is required}"

if [ -t 0 ]; then
  echo 'ERROR: RouterOS password must be supplied on stdin, not interactively.' >&2
  exit 1
fi

IFS= read -r ROUTEROS_PASSWORD || true
export ROUTEROS_PASSWORD

if [ -z "$ROUTEROS_PASSWORD" ]; then
  echo 'ERROR: empty RouterOS password supplied to conformance runner.' >&2
  exit 1
fi

trap 'unset ROUTEROS_PASSWORD' EXIT HUP INT TERM

node --version
npm --version
npm run test:conformance
