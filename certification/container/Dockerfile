FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df

WORKDIR /workspace

COPY package.json package-lock.json ./
RUN test "$(node --version)" = "v24.19.0" \
 && test "$(npm --version)" = "11.17.0" \
 && npm ci --ignore-scripts

COPY . .

ENTRYPOINT ["/bin/sh", "certification/container/run.sh"]
