# TANDA / physical HotSpot certification

These scripts certify the frozen SDK candidate `rc/v0.1.0-rc2` against a real RouterOS HotSpot without installing the SDK into BOZZ-CENTER Gateway.

Frozen candidate:

- SDK SHA: `8a3cd500aa5013577ca1f8179c916dc7807cf392`
- tarball SHA-256: `343ce993318cd44e383162a25fdb0a0e7cf40bb0c0aaf3304d57826995e896c5`
- Node: `24.19.0`
- npm: `11.17.0`

## Secret handling

`certification/tanda/run.sh` reads the RouterOS password from stdin. Do not pass the password as a command-line argument, commit it, bake it into an image, or store it in a report.

Required non-secret environment:

```bash
export ROUTEROS_HOST=...
export ROUTEROS_USERNAME=...
export ROUTEROS_PORT=8728
```

For API-SSL:

```bash
export ROUTEROS_TLS=1
export ROUTEROS_PORT=8729
export ROUTEROS_CA_FILE=/run/secrets/routeros-ca.pem
export ROUTEROS_TLS_SERVERNAME=router.example.internal
```

The harness never enables `rejectUnauthorized=false`.

A secret-store process can pipe one password line to the runner, for example conceptually:

```bash
secret-command | sh certification/tanda/run.sh passive
```

## 1. Passive gate — non-destructive

```bash
secret-command | sh certification/tanda/run.sh passive
```

Checks:

- login + RouterOS version/uptime read;
- real empty `/ip/hotspot/active` query returns `[]`;
- real empty `/ip/hotspot/user` query returns `[]`;
- configurable concurrent tagged empty reads (default 64);
- simultaneous `/ip/hotspot/active/listen` and `/ip/hotspot/user/listen`;
- independent `/cancel` lifecycles;
- zero pending tags, protocol errors, or transport faults at completion.

No MAC/IP/client payload is emitted in the JSON report.

Optional controls:

```bash
export ROUTEROS_CONCURRENCY=64
export ROUTEROS_OBSERVE_MS=5000
```

## 2. `.dead=yes` gate — LAB client only

Set a dedicated LAB HotSpot username, then start the observer **before** logging that LAB client in/out:

```bash
export ROUTEROS_TEST_USER='BOZZ-RC2-LAB'
secret-command | sh certification/tanda/run.sh dead-watch
```

The harness correlates RouterOS `.id` values and requires a real `=.dead=yes` event for one active occurrence of that LAB user. It does not assume that the `.dead=yes` reply repeats the `user` field.

Default deadline is 120 seconds. Override with `ROUTEROS_DEAD_TIMEOUT_MS` if needed.

## 3. `active/remove` gate — destructive only to the named LAB session

This gate intentionally refuses to execute unless all safeguards pass:

- `ROUTEROS_TEST_USER` is explicitly provided;
- that user exists exactly once in `/ip/hotspot/user`;
- exactly one active session exists for that user;
- `ROUTEROS_ALLOW_ACTIVE_REMOVE` equals the exact confirmation phrase below.

```bash
export ROUTEROS_TEST_USER='BOZZ-RC2-LAB'
export ROUTEROS_ALLOW_ACTIVE_REMOVE='I_UNDERSTAND_TEST_SESSION_ONLY'
secret-command | sh certification/tanda/run.sh active-remove
```

The harness starts `active/listen`, removes only that single active `.id`, requires the correlated `.dead=yes`, verifies the active occurrence disappeared, and verifies the HotSpot user account still exists with the same RouterOS `.id`.

Never point this mode at a real customer/user session.

## 4. Real listener soak

First 2 hours:

```bash
export ROUTEROS_SOAK_SECONDS=7200
export ROUTEROS_SOAK_SAMPLE_SECONDS=60
secret-command | sh certification/tanda/run.sh soak > rc2-soak-2h.jsonl
```

Then 24 hours:

```bash
export ROUTEROS_SOAK_SECONDS=86400
export ROUTEROS_SOAK_SAMPLE_SECONDS=60
secret-command | sh certification/tanda/run.sh soak > rc2-soak-24h.jsonl
```

Every sample records only process/protocol health data:

- RSS, heap used, external and ArrayBuffer memory;
- CPU usage;
- stable Node active-resource types;
- RouterOS SDK runtime/event-loop diagnostics;
- `pendingTags`;
- queued replies per stream;
- active/user event counts including `.dead=yes` counts;
- orphan/protocol/transport/disconnect counts.

Evaluate memory and resource **slopes**, not only the final value. Final `pendingTags` and both stream queues must return to zero.

## 5. Network interruption / CHR reboot probe

Run:

```bash
export ROUTEROS_RECONNECT_TIMEOUT_MS=180000
secret-command | sh certification/tanda/run.sh reconnect
```

After the `reconnect-probe-ready` JSON line appears, interrupt only the certification client's network namespace or reboot the disposable CHR VM. The probe requires:

- a real disconnect event;
- supervisor reconnect;
- generation increase;
- second online event;
- a successful RouterOS read after recovery.

Run this on CHR before any physical-router maintenance test.

## TANDA reboot

A physical TANDA reboot is **not** part of the non-destructive certification sequence. It requires a separate explicit maintenance window. CHR reboot certification must pass first.
