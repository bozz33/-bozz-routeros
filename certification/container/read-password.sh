#!/bin/sh

# Source this file, then call read_routeros_password. The secret may be passed
# through stdin for short foreground runs or through a read-only mounted file
# for a detached long-running container. The function never prints it.
read_routeros_password() {
  if [ -n "${ROUTEROS_PASSWORD_FILE:-}" ]; then
    if [ ! -r "$ROUTEROS_PASSWORD_FILE" ]; then
      echo "ERROR: ROUTEROS_PASSWORD_FILE is not readable: $ROUTEROS_PASSWORD_FILE" >&2
      return 1
    fi
    IFS= read -r ROUTEROS_PASSWORD < "$ROUTEROS_PASSWORD_FILE" || true
  else
    if [ -t 0 ]; then
      echo 'ERROR: RouterOS password must be supplied on stdin or through ROUTEROS_PASSWORD_FILE.' >&2
      return 1
    fi
    IFS= read -r ROUTEROS_PASSWORD || true
  fi

  if [ -z "$ROUTEROS_PASSWORD" ]; then
    echo 'ERROR: empty RouterOS password supplied.' >&2
    return 1
  fi

  export ROUTEROS_PASSWORD
}
