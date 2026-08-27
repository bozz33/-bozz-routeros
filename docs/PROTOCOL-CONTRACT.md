# RouterOS Protocol Contract

This document defines the behavior `@bozz/routeros` promises independently of any upstream client implementation.

## Replies

| Reply | Meaning in BOZZ transport | Terminal? |
|---|---|---|
| `!re` | Append one record/update to the matching tag | No |
| `!empty` | Successful observation with no records | No; wait for `!done` |
| `!trap` | Accumulate command error information | No; wait for `!done` |
| `!done` | Normal completion for the matching command/listener lifecycle | Yes |
| `!fatal` | Connection-level fatal failure | Yes, connection-wide |

## Unknown or late tags

A reply whose `.tag` is not registered MUST NOT throw out of the socket data handler. The implementation must expose/record it as an orphan protocol event and continue processing the connection unless RouterOS also sent `!fatal` or the socket itself is unusable.

## Cancellation

A listener tag and its `/cancel` command tag are independent lifecycles. Completion of the `/cancel` command is not sufficient to release the original listener tag. The original tag is released only when its own terminal lifecycle is observed or the socket closes.

## Timeouts

Timeout is a local client policy. Timing out a read may safely allow a controlled replay according to caller policy. Timing out a mutation does NOT prove RouterOS failed to apply it.

## Ambiguous writes

For `add`, `set`, `remove`, and other mutations, loss of the acknowledgement after bytes were written produces an ambiguous outcome. The library exposes `RouterOSAmbiguousWriteError`; the application must perform read-after-write reconciliation before retrying.

## Streams

`listen` is represented as an AsyncIterable stream. A stream must support cancellation via AbortSignal and explicit `cancel()`. Backpressure policy must prevent a slow consumer from allowing unbounded memory growth.

## Transport

TCP and TLS transports use Node.js native networking primitives. The library must support TCP keepalive and `TCP_NODELAY`. TLS certificate verification defaults to secure behavior; disabling verification must require explicit configuration.
