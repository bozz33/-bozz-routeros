FROM node:24.19.0-bookworm@sha256:934240a162082fd8b8a2f90cd5114446443f1eba1c5378f6687167ca405e6584

WORKDIR /workspace

COPY package.json package-lock.json ./
RUN test "$(node --version)" = "v24.19.0" \
 && test "$(npm --version)" = "11.17.0" \
 && command -v openssl >/dev/null \
 && npm ci --ignore-scripts

COPY . .

# Certification images must be immediately usable by the external CHR/TANDA
# harness. Normalize published-file modes independently of the host checkout,
# then build the SDK once so package self-references resolve through dist/.
RUN sh certification/container/normalize-package-modes.sh \
 && npm run build \
 && test -f dist/index.js \
 && test -f dist/index.d.ts

ENTRYPOINT ["/bin/sh", "certification/container/run.sh"]
