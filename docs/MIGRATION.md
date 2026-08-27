# Migration from `node-routeros`

`@bozz/routeros` is not a drop-in API-compatible replacement. Migrate behind an application adapter and preserve the legacy path until shadow comparison passes.

## Main differences

| Concern | Legacy assumption | `@bozz/routeros` contract |
| --- | --- | --- |
| empty result | may surface as an unknown reply | `!empty` is successful and remains non-terminal until `!done` |
| concurrency | commonly serialized/pool-specific | commands are multiplexed by `.tag` |
| listen | callback/library-specific | bounded `AsyncIterable` stream |
| cancel | implicit lifecycle | listener tag and cancel tag are tracked independently |
| write timeout | often retried generically | may throw `RouterOSAmbiguousWriteError`; read-after-write reconciliation required |
| reconnect | application/library-specific | optional generic supervisor with generation |
| menu API | hard-coded helpers | raw paths plus open-ended dynamic overlay |

## Recommended sequence

1. Add an adapter exposing only the application's RouterOS operations.
2. Install the SDK from an immutable package/tarball.
3. Run the new client in shadow read/listen mode with writes disabled.
4. Compare normalized results, including empty queries and raw `.dead` events.
   RouterOS 7.24.1 has been observed emitting `true`; accept `yes` too if the
   application needs compatibility with earlier observations/examples.
5. Introduce explicit read/write command classification.
6. Reconcile every ambiguous mutation before retrying.
7. Cut over one operation/route at a time with rollback to the legacy adapter.

BOZZ-CENTER composes CONTROL, ACTIVE, and USERS connections above the SDK. That three-socket topology is not embedded in this package.
