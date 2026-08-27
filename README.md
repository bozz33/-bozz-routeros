# @bozz/routeros

Modern, protocol-correct RouterOS Binary API SDK for Node.js and TypeScript.

The package is deliberately application-agnostic. It contains no BOZZ-CENTER, tenant, voucher, Redis, accounting, or HotSpot business policy.

## Status

The v0 core is feature-complete. RC2 passes the complete reproducible software gate and TANDA RouterOS 7.24.1 conformance plus a real two-hour ACTIVE/USERS listener soak. Stable `0.1.0` remains blocked on the documented 24-hour, CHR/reconnect/reboot, and physical LAB gates.

- RC2 SHA: `8a3cd500aa5013577ca1f8179c916dc7807cf392`
- Node: `v24.19.0`
- npm: `11.17.0`
- normalized tarball SHA-256: `343ce993318cd44e383162a25fdb0a0e7cf40bb0c0aaf3304d57826995e896c5`

No stable npm package has been published yet.

## Runtime

- Node.js `>=24.19.0`
- ESM
- strict TypeScript declarations
- zero runtime dependencies
- RouterOS 7.24.1 is the initial certified target; other RouterOS versions are not claimed as certified by v0.1.0

## Core capabilities

- incremental RouterOS word/sentence codec with resource limits;
- native TCP and verified TLS/API-SSL transport;
- login, raw `execute`, `print`, query words, and an open-ended dynamic path API;
- strict `!re`, `!empty`, `!trap`, `!done`, and `!fatal` lifecycles;
- concurrent `.tag` multiplexing;
- bounded `listen` streams exposed as `AsyncIterable`;
- raw reply strings preserved without boolean coercion;
- correct dual-tag `/cancel` cleanup;
- AbortSignal-safe cancellation and ambiguous-connection quarantine;
- conservative ambiguous-write errors instead of unsafe automatic replay;
- optional reconnect supervisor with backoff, jitter, and generation;
- optional Node event-loop/runtime diagnostics.

## Basic use

```ts
import { RouterOSClient, routerOSQuery } from '@bozz/routeros';

const password = process.env.ROUTEROS_PASSWORD;
if (!password) throw new Error('ROUTEROS_PASSWORD is required');

const client = new RouterOSClient({
  host: 'router.example.internal',
  username: 'api-readonly',
  password,
  kind: 'tls',
  tls: {
    ca: process.env.ROUTEROS_CA_PEM,
    servername: 'router.example.internal',
  },
});

try {
  const resources = await client.print('/system/resource', {
    attributes: { '.proplist': ['version', 'uptime', 'cpu-load'] },
  });

  const active = await client.print('/ip/hotspot/active', {
    attributes: { '.proplist': ['.id', 'user', 'uptime'] },
    queries: routerOSQuery().equals('user', 'alice').toWords(),
  });

  console.log({ resources, active });
} finally {
  await client.close();
}
```

TLS certificate and hostname verification are enabled by Node defaults. The SDK never exposes an option that silently sets `rejectUnauthorized=false`.

## Listen and cancel

```ts
const stream = await client.listen('/interface', {
  maxQueuedReplies: 1024,
  overflowPolicy: 'error',
});

try {
  for await (const reply of stream) {
    if (reply.type === 're') console.log(reply.attributes);
  }
} finally {
  await stream.cancel();
}
```

RouterOS uses one tag for the listener and another for `/cancel`. The SDK tracks both until terminal completion. If cleanup becomes unknowable, it closes the connection instead of pretending the listener stopped.

## Write safety

Unknown commands are conservatively classified as writes. When bytes may have reached RouterOS but the terminal acknowledgement is lost, the SDK throws `RouterOSAmbiguousWriteError`. Reconcile with a read before deciding whether a retry is safe.

## Dynamic paths

```ts
import { createRouterOSApi } from '@bozz/routeros';

const api = createRouterOSApi(client);
const users = await api.ip.hotspot.user.print();
const futureMenu = await api.path('some', 'future-menu').print();
```

## Documentation

- [API reference](docs/API.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Protocol contract](docs/PROTOCOL-CONTRACT.md)
- [Conformance](docs/CONFORMANCE.md)
- [Support matrix](docs/SUPPORT.md)
- [Migration from node-routeros](docs/MIGRATION.md)
- [Release process](docs/RELEASE.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## License

Apache-2.0. Upstream attribution and the pinned adaptation baseline are recorded in [NOTICE](NOTICE).
