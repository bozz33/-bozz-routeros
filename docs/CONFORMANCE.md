# RouterOS Conformance

`@bozz/routeros` treats the current MikroTik RouterOS API manual and the Node.js runtime documentation as normative references. Third-party SDKs are implementation references only.

Normative references:

- MikroTik RouterOS API: https://manual.mikrotik.com/docs/developer-guides/api/
- MikroTik REST API: https://manual.mikrotik.com/docs/developer-guides/rest-api/
- Node.js `net`: https://nodejs.org/api/net.html
- Node.js `tls`: https://nodejs.org/api/tls.html
- Node.js `events`: https://nodejs.org/api/events.html

## Local conformance gates

The normal test suite validates, among other things:

- RouterOS binary word-length encoding/decoding;
- fragmented and coalesced TCP input;
- `!re`, `!empty`, `!trap`, `!done`, and `!fatal`;
- `!empty` remaining non-terminal until the matching `!done`;
- concurrent command multiplexing by `.tag`;
- orphan/late replies not crashing the process;
- bounded long-running streams;
- `.dead=yes`-compatible raw reply handling;
- `/cancel` using a separate cancel tag and target `=tag`;
- both cancel-tag and target-tag reaching terminal state;
- caller AbortSignal cancellation not suppressing RouterOS-side cleanup;
- hard cancel timeout quarantining/closing an ambiguous connection;
- ambiguous write classification when an acknowledgement is lost;
- TLS CA and server-identity verification;
- SNI behavior for DNS names vs IP literals;
- exponential reconnect backoff and jitter;
- 10,000 command tag-lifecycle stress;
- 1,000 listen/cancel lifecycle stress;
- 20,000-event listen soak;
- npm package assembly.

## Real RouterOS harness

Real-device tests are opt-in and read-only by default.

Required environment variables:

```bash
export ROUTEROS_HOST=192.0.2.10
export ROUTEROS_USERNAME=conformance
export ROUTEROS_PASSWORD='...'
```

Optional:

```bash
export ROUTEROS_PORT=8729
export ROUTEROS_TLS=1
```

Run:

```bash
npm test
```

When `ROUTEROS_HOST` and `ROUTEROS_USERNAME` are absent, real-router tests are skipped.

The harness currently checks:

1. login and basic reads;
2. an intentionally empty HotSpot query returning `[]` rather than a protocol error;
3. concurrent tagged reads;
4. a real `listen` followed by `/cancel`, requiring all local tags to be released.

## Production certification gates

A release can be feature-complete before it is production-certified. Production certification additionally requires successful execution against:

1. a RouterOS CHR instance on a supported RouterOS 7.x version;
2. the current RouterOS stable version used by the target environment;
3. long-running listener tests over a real network path;
4. reconnect tests involving actual TCP interruption and RouterOS restart;
5. TLS/API-SSL validation when API-SSL is used;
6. leak monitoring over extended operation.

For BOZZ-CENTER specifically, TANDA RouterOS 7.24.1 is an integration target, but no TANDA-specific behavior belongs in the public SDK core.
