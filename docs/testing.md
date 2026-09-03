# Test and mutation review

The test strategy uses independent invariants, not agreement with one solver
implementation. Exact candidates are substituted into the original equation;
numeric candidates use scaled residuals; periodic families are instantiated at
negative, zero, and positive integer parameters; and known-factor polynomials are
generated from their roots.

## Mutation-sensitive guards

The following deliberate fault classes are paired with tests that distinguish the
correct behavior. They are reviewed whenever the corresponding solver changes.

| Deliberate fault | Test that fails |
|---|---|
| Admit a perturbed non-root | `hardening.spec.ts` candidate-verification control |
| Remove circular/inverse range checks | hardening and trigonometric out-of-range cases |
| Accept a rational or tangent singularity | `numeric-solve.spec.ts` singularity cases and hardening discontinuity control |
| Mark adaptive interval search complete | numeric-search contract and hardening completeness assertions |
| Drop symbolic leading-coefficient conditions | symbolic cubic/quartic and complex quadratic condition tests |
| Collapse repeated numeric roots without multiplicity | numeric-polynomial and complex repeated-root tests |
| Ignore open interval endpoints | numeric-search endpoint test |
| Let one solve-for-all target share another target's state | solve-for-all limit and dispatcher concurrency tests |
| Reorder dispatcher stages ahead of exact rules | dispatcher precedence snapshots |
| Omit a result or limit classification | hardening result-union and solver-budget tables |

## Permanent suites

- `test/fixtures/baseline.json` freezes the initial public behavior.
- `test/fixtures/conformance.json` catalogs current support by mathematical class.
- Seeded `fast-check` properties cover parsing, affine/rational transformations,
  trigonometric reconstruction, polynomial roots, and complex degree accounting.
- Adversarial tests cover deep trees, branch growth, huge parameter intervals,
  high degree, invalid domains, and discontinuity-heavy search.
- `scripts/benchmark.mjs` names latency regression groups.
- `scripts/verify-pack.mjs` installs the packed artifact in a temporary ESM consumer.
- `scripts/verify-release.mjs` checks version, workflow, and tag invariants.

Coverage thresholds are 95% for statements, functions, and lines and 90% for
branches. Thresholds are a floor; mathematical negative controls remain required
even when a line is already covered.
