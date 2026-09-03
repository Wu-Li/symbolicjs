# 0.5 release checklist

## Verified by `npm run check`

- [x] Unit, conformance, property, fuzz, coverage, typecheck, build, benchmark,
      release-metadata, and packed-consumer gates are part of one command.
- [x] Every admitted finite candidate has symbolic, construction, bracket, sample,
      or scale-aware residual verification evidence.
- [x] Approximate roots are marked `exact: false`; accuracy and completeness are
      documented.
- [x] Denominator, root, logarithm, range, and leading-coefficient conditions have
      regression tests.
- [x] Every public result kind and safety-limit family has a typed test.
- [x] The npm tarball excludes source/tests/workflows and includes `dist`, docs,
      README, license, changelog, and package metadata.
- [x] The packed tarball installs into a temporary ESM consumer and exercises real
      finite, parametric, bounded numeric, complex polynomial, persistence, and
      solve-for-all APIs.
- [x] README examples execute in the test suite.
- [x] The release script verifies that package and lockfile versions match and a
      release tag is exactly `v<package version>`.

## Required before publishing

- [ ] CI passes on Node 22, 24, and 26 against MathJS 15.2.0 and the latest
      compatible MathJS 15 release.
- [ ] A `0.5.0` release candidate receives API feedback or is explicitly waived by
      the maintainer.
- [ ] The tag-triggered workflow completes and npm records provenance for the
      published artifact.

Do not publish `1.0.0` until the public API has completed a stable feedback cycle
and the remaining unsupported scope in `docs/api.md` is acceptable for 1.0.
