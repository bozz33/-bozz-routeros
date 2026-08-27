# Security policy

## Supported versions

Security fixes are provided for the latest published stable version. Before `0.1.0`, report issues against the current release candidate without using it as a production guarantee.

## Reporting a vulnerability

Use GitHub private vulnerability reporting for `bozz33/-bozz-routeros`. Do not open a public issue containing credentials, private addresses, certificates, packet captures, or an exploitable proof before coordinated disclosure.

Include the affected version/SHA, Node and RouterOS versions, transport mode, minimal reproduction, expected/observed behavior, and security impact. Remove all secrets and customer payloads.

## Operational requirements

- create least-privilege RouterOS API users;
- restrict RouterOS API service addresses with firewall/service policy;
- prefer API-SSL with CA and hostname verification when crossing an untrusted network;
- never use `rejectUnauthorized=false`;
- supply passwords through a secret manager or protected process input, not source, command arguments, Git, reports, or images;
- treat `RouterOSAmbiguousWriteError` as an unknown outcome and reconcile before retry;
- bound listener queues and monitor protocol/transport/orphan diagnostics;
- never run destructive conformance modes against customer sessions.

The SDK does not encrypt credentials beyond the selected transport. Plain TCP must be confined to an appropriately trusted/private path.
