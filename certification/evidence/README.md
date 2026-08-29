# Certification evidence validation

Validate a TANDA/CHR soak JSONL before accepting it as release evidence:

```bash
CERT_EXPECTED_CANDIDATE='<candidate-sha>' \
CERT_EXPECTED_DURATION_SECONDS=86400 \
node certification/evidence/validate-soak.mjs path/to/soak-24h.jsonl
```

The validator checks candidate identity, requested duration, sampling continuity, two live listener tags during the run, bounded queues, monotonic event counters, clean protocol diagnostics, terminal cleanup, and configurable memory slopes/growth.

Default memory limits are deliberately explicit and can be made stricter by the certification operator:

- RSS slope: 16 MiB/hour;
- heap-used slope: 2 MiB/hour;
- external/ArrayBuffer slope: 1 MiB/hour;
- final RSS growth: 128 MiB;
- final heap growth: 32 MiB.

The output includes the SHA-256 of the evidence file. Preserve the raw JSONL outside Git and attach it to the immutable GitHub release/certification record.

## Interrupted runs

A run without exactly one terminal `soak-final`, a run ending before the
configured duration, or a container with a non-zero exit code is
FAIL/incomplete. Preserve it as diagnostic evidence, but never concatenate it
with another run or accept it as release evidence. Independent logs may
attribute the interruption to the WAN, host, or router; attribution does not
change the strict gate result.

Supervisor-based recovery soaks belong to application integration certification
and do not replace this continuous-connection gate.
