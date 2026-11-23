# Changelog

## Unreleased

- Restore the policy that full verification runs only on manual dispatch, chapter
  integration gates, and release publishing, not on every push.
- Add the missing 0.5.3 and 0.6.0 changelog entries and remove README links to
  deleted documents.

## 0.6.0 - 2026-09-06

- Add the experimental instance-local `math.symbolic` service, built around MathJS
  nodes without mutating them (architecture-migration Chapters 1–8):
  - operation contexts with limits, scopes, and diagnostics;
  - immutable assumptions, a scalar domain lattice, three-valued predicates, and
    definedness obligations;
  - lossless structural identity, fingerprints, deterministic ordering, and
    expression cost;
  - bounded, idempotent, assumption-aware canonicalization profiles;
  - shared dependency analysis and transient sum, product, power, affine, linear,
    sparse-polynomial, and rational-function views;
  - typed pattern matching with semantic guards and bounded associative/commutative
    matching (`math.symbolic.match()`);
  - typed rewrite rules, bounded strategies, requirement-preserving traces, and
    foundational and compound-trigonometric rule packs
    (`math.symbolic.rewriteExpression()`);
  - conservative staged equivalence (`math.symbolic.equivalent()`) and shared
    substitution verification (`math.symbolic.verifySubstitution()`), where numeric
    sampling can reject but never prove.
- Export the pattern, rewrite, equivalence, and verification contracts together with
  the `pattern`, `rewriteRule`, `strategy`, and rule-pack factories.
- Route existing polynomial and compound-trigonometric recognizers, the legacy
  canonical key, and `SymbolicKernel.verify()` through the shared services. Solver
  result contracts and dispatch are unchanged.
- Publish from a published GitHub Release after verifying that the tag matches the
  package version and the version is unpublished. Full verification now runs on
  Node 26 with the latest compatible MathJS 15 release.

## 0.5.3 - 2026-09-03

- Repair automatic publishing of the 0.5 line. No library changes.

## 0.5.2 - 2026-09-03

- Repair automatic publishing so a successful `main` CI run releases the current
  package without requiring a hand-authored changelog heading.
- Create the release tag before publishing so a failed npm attempt can be retried
  without losing the source revision.

## 0.5.1 - 2026-09-03

- Stabilize the clustered-root quartic test under CI load.
- Publish automatically after successful CI on `main` while safely skipping versions
  that already exist on npm.

## 0.5.0 - 2026-09-03

- Add typed real and opt-in finite complex equation-solving domains with explicit
  conditions, verification evidence, completeness scopes, and deterministic
  safety limits.
- Add single-occurrence isolation; rational, affine, and quadratic solving;
  conditional symbolic cubic and quartic constructions; and verified numeric
  polynomial roots through a configurable degree limit tested to degree 100.
- Add complete parametric families for isolated circular functions and conservative
  compound-trigonometric reductions.
- Add explicitly bounded adaptive real numeric fallback with bracket, tangent-root,
  singularity, endpoint, residual, and work-budget guards.
- Add solve-for-all orchestration, deterministic diagnostics, partial-result
  merging, configured MathJS namespace support, and EqualityNode persistence tests.
- Add a framework-neutral 20-class conformance corpus, seeded property/fuzz tests,
  adversarial limit tests, named performance baselines, README execution tests,
  and expanded packed-consumer verification.
- Document algorithms, accuracy, limits, security, migration, conformance, and
  remaining unsupported equation classes.

## 0.0.1

- Add the initial MathJS extension factories.
- Add **EqualityNode** with **lhs** and **rhs** expression trees.
- Add **parseEquation** with canonical **=:=** syntax.
- Add independent tests, build configuration, CI, and publishing workflow.
