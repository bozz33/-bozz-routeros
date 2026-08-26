FROM node:24.19.0-bookworm@sha256:934240a162082fd8b8a2f90cd5114446443f1eba1c5378f6687167ca405e6584

WORKDIR /workspace

COPY package.json package-lock.json ./
RUN test "$(node --version)" = "v24.19.0" \
 && test "$(npm --version)" = "11.17.0" \
 && command -v openssl >/dev/null \
 && npm ci --ignore-scripts

COPY . .

ENTRYPOINT ["/bin/sh", "certification/container/run.sh"]
