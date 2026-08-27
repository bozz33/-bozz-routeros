# Changelog

All notable changes to this project are documented here.

## [Unreleased]

- complete remaining RC2 real RouterOS certification gates;
- finalize stable `0.1.0` package metadata and release evidence.
- clarify that RouterOS 7.24.1 emits the raw HotSpot marker `.dead=true` and
  that the SDK deliberately performs no boolean coercion.

## [0.1.0-rc.2] - 2026-08-27

- complete feature-frozen v0 Binary API core;
- add TCP/TLS transport, tagged command multiplexing, strict reply lifecycle, bounded listeners, dual-tag cancellation, ambiguous-write errors, reconnect supervision, and runtime diagnostics;
- pass 47 generic tests and five stress tests;
- pass real TANDA RouterOS 7.24.1 conformance and two-hour listener soak;
- make the synthetic 20k-listener producer deterministic without changing the published runtime artifact.

This entry identifies the internal RC2 candidate. No npm package or stable GitHub release has been published yet.
