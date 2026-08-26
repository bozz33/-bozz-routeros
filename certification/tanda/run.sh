#!/bin/sh
set -eu

MODE="${1:-passive}"
: "${ROUTEROS_HOST:?ROUTEROS_HOST is required}"
: "${ROUTEROS_USERNAME:?ROUTEROS_USERNAME is required}"

if [ -t 0 ]; then
  echo 'ERROR: RouterOS password must be supplied on stdin.' >&2
  exit 1
fi

IFS= read -r ROUTEROS_PASSWORD || true
if [ -z "$ROUTEROS_PASSWORD" ]; then
  echo 'ERROR: empty RouterOS password supplied.' >&2
  exit 1
fi
export ROUTEROS_PASSWORD
trap 'unset ROUTEROS_PASSWORD' EXIT HUP INT TERM

case "$MODE" in
  passive)
    exec node certification/tanda/passive.mjs
    ;;
  dead-watch)
    exec node certification/tanda/dead-watch.mjs
    ;;
  active-remove)
    exec node certification/tanda/active-remove.mjs
    ;;
  soak)
    exec node certification/tanda/soak.mjs
    ;;
  reconnect)
    exec node certification/chaos/reconnect-probe.mjs
    ;;
  *)
    echo "ERROR: unknown mode: $MODE" >&2
    echo 'Modes: passive | dead-watch | active-remove | soak | reconnect' >&2
    exit 2
    ;;
esac
