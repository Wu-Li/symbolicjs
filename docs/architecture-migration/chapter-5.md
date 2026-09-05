# Chapter 5 — Structural algebra analysis and transient algebraic views

## Status

Implemented on the `feat/mathjs-symbolic-layer` branch. This chapter adds shared
analysis and algebraic views while preserving the existing public solving contracts
and MathJS `MathNode` representation.

## Impact map

Chapter 5 introduces:

- configured-instance-aware free-symbol discovery that excludes function callees
  and imported constants;
- shared dependency, occurrence, operator/function inventory, definedness, and safe
  evaluation analysis;
- immutable `SumView`, `ProductView`, `PowerView`, `AffineView`, and arbitrary-basis
  `LinearForm` representations;
- sparse multivariate polynomial views using exponent vectors and MathJS-node
  coefficients proven independent of the selected generators;
- rational-function views whose requirements retain denominator nonzero obligations;
- explicit degree, monomial, convolution, traversal, and rebuild limits;
- deterministic polynomial and rational canonicalization profiles;
- delegation from the legacy polynomial solver and compound-trigonometric amplitude
  extraction to the shared algebra service;
- the instance-local `math.symbolic.algebra` entry point.

Transient views contain and rebuild MathJS nodes. They are algorithmic data
structures, not a second persisted expression tree.

## Semantic boundaries

- Coefficients may be arbitrary MathJS expressions, but they must be independent of
  every selected generator and scalar under the operation context.
- Unknown scalar and denominator facts become requirements in conditional mode and
  typed failures in strict mode.
- Polynomial views accept only nonnegative integral powers of their generators.
- Rational views additionally accept negative integral powers and explicit division,
  while preserving all original denominator obligations.
- Expansion is explicit and sparse; unsupported expressions return
  `not-representable` rather than being guessed into an algebraic form.
- A zero polynomial has total and per-generator degree `-1`.

## Regression risks and verification

| Risk | Verification |
|---|---|
| Imported constants or function names are mistaken for variables | Configured namespace and function-callee tests cover free-symbol discovery and semantic evaluation. |
| Selected symbol and structural-atom occurrences are double-counted | Overlapping-selection tests assert union semantics. |
| Coefficients retain generator dependence | Every produced coefficient is checked, and reconstruction tests cover symbolic coefficients. |
| Sparse expansion grows without bound | Independent limits cover nodes, depth, degree, monomials, convolutions, and rebuild nodes. |
| Rational normalization loses domain restrictions | Original and rebuilt denominator requirements are asserted, including strict/disproven cases. |
| Configured numeric types are coerced to JavaScript numbers | Fraction, BigNumber, and bigint coefficient/exponent tests exercise configured MathJS values. |
| Legacy polynomial extraction changes solver behavior | Polynomial, cubic, quartic, complex-polynomial, solver-contract, and migration baseline suites exercise the adapter. |
| Compound-trig amplitude extraction changes | Existing compound-trigonometric tests run against the shared `LinearForm`. |
| Algebraic canonicalization is nondeterministic or non-idempotent | Polynomial/rational profile tests compare repeated structural results. |
| New core code drops coverage below the release gate | Edge/failure-path tests exercise strict, conditional, unsupported, and limit branches before the complete gate. |

## Test scope

Focused development checks:

```text
test/algebra-analysis.spec.ts
test/algebra-views.spec.ts
test/algebra-hardening.spec.ts
test/algebra-failure-paths.spec.ts
test/canonicalize.spec.ts
test/polynomial.spec.ts
test/cubic.spec.ts
test/quartic.spec.ts
test/complex-polynomial.spec.ts
test/compound-trigonometric.spec.ts
test/migration-baseline.spec.ts
test/solver-contract.spec.ts
npm run typecheck
npm run build
npm run test:pack
```

Because Chapter 5 modifies cross-cutting symbolic-core analysis and delegates two
existing solver subsystems to the new views, its final gate runs the complete
repository command:

```text
npm run check
```

That gate includes all tests with coverage thresholds, the production build,
benchmarks, packed-consumer verification, and release-workflow validation.
