# RC2 documentation errata

Updated: 2026-08-29

## Scope and immutability

The frozen RC2 candidate is commit
`8a3cd500aa5013577ca1f8179c916dc7807cf392` with normalized public tarball
SHA-256
`343ce993318cd44e383162a25fdb0a0e7cf40bb0c0aaf3304d57826995e896c5`.

The public package payload contains historical examples that mention only
`=.dead=yes`. RouterOS 7.24.1 was subsequently observed emitting
`=.dead=true`. The SDK is intentionally schema-agnostic for reply attributes
and exposed the raw value correctly; no runtime/source correction is required.

Until the next package identity is created, read every public-package
`=.dead=yes` example as:

```text
=.dead=true or =.dead=yes, depending on RouterOS behavior
```

Certification tooling accepts exactly the raw string values `true` and `yes`
for the HotSpot dead marker. It does not coerce arbitrary truthy values.

## Files affected in the frozen package

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/CONFORMANCE.md`
- `docs/RELEASE.md`

Those files cannot be edited on `cert/rc2` because they are included in the
certified package payload. The certification workflow deliberately fails if
the branch changes package or source files relative to the frozen candidate.

## Release correction

The release-preparation commit that creates the next public package identity
must update every affected example to `.dead=true/yes`, set the intended
package version, rebuild the tarball, record its new SHA-256, and rerun the
software/container/package gates. It must explicitly document that the runtime
and source remain identical to RC2 if that is still true.

This erratum does not waive any pending physical or CHR gate and does not permit
stable publication before the certification verdict is complete.
