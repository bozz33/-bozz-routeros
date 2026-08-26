#!/bin/sh
set -eu

# npm preserves file modes from the working tree for package payload files.
# Git records these files as non-executable (100644), but some checkout/build
# contexts may materialize them as 0600. Normalize only files that are part of
# the published package and are expected to be non-executable.
for file in package.json README.md LICENSE NOTICE; do
  if [ -f "$file" ]; then
    chmod 0644 "$file"
  fi
done

if [ -d docs ]; then
  find docs -type f -exec chmod 0644 {} +
fi
