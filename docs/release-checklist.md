# Stable release checklist

Do not publish `1.0.0` until every item is satisfied.

- [ ] Public API names and discriminated result types have completed an RC cycle.
- [ ] Unit, corpus, property, fuzz, coverage, typecheck, build, benchmark, and
      packed-consumer gates pass on Node 22, 24, and 26.
- [ ] CI passes against MathJS 15.2.0 and the latest compatible MathJS 15 release.
- [ ] Every finite candidate is verified against the original equation.
- [ ] Approximate roots are marked `exact: false` and meet documented tolerance.
- [ ] Denominator, root, logarithm, and coefficient conditions survive normalization.
- [ ] Unsupported families and every safety limit return stable reason codes.
- [ ] The npm tarball contains only intended `dist`, `docs`, README, license,
      changelog, and package metadata files.
- [ ] The API guide, limitations, security guidance, and changelog match the tarball.
- [ ] A release-candidate tarball installs and runs in an independent ESM project.
- [ ] Trusted publishing records npm provenance from the tag workflow.
