# @bozz/routeros 0.1.0 release notes

Status: draft until the remaining RC2 real certification gates pass.

`0.1.0` introduces the first protocol-correct, general-purpose RouterOS Binary API SDK in the BOZZ namespace. The release focuses on reliable TCP/TLS framing, strict RouterOS reply lifecycles, concurrent tagged commands, bounded realtime listeners, safe cancellation, and explicit ambiguity around writes.

The initial certification claim is intentionally narrow: Node.js 24.19.0+ and RouterOS 7.24.1. BOZZ-CENTER integration remains a separate shadow/cutover project.

Before publishing this document as final, replace the draft status with immutable links/hashes for the 24-hour soak, CHR reconnect/reboot gates, physical LAB gates, stable commit, tag, GitHub release, and npm provenance.
