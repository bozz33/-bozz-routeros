#!/bin/sh
set -eu

: "${ROUTEROS_HOST:?ROUTEROS_HOST is required}"
: "${ROUTEROS_USERNAME:?ROUTEROS_USERNAME is required}"

. certification/container/read-password.sh
read_routeros_password

trap 'unset ROUTEROS_PASSWORD' EXIT HUP INT TERM

node --version
npm --version
npm run test:conformance
