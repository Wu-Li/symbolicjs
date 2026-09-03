# Changelog

## Unreleased

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
