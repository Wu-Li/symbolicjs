# Chapter 2 — Assumptions, domains, predicates, and definedness

## Status

Implemented on the `feat/mathjs-symbolic-layer` branch. Public solver result and
condition types remain unchanged.

## Impact map

Chapter 2 establishes the semantic layer needed by canonicalization, matching,
rewriting, equivalence, and later solver migrations:

- immutable predicates for scalar domains, zero/sign, finite/defined, parity,
  scalar eligibility, and commutativity;
- frozen 3-valued judgments (`proven`, `disproven`, `unknown`) with evidence and
  outstanding requirements;
- persistent `AssumptionSet` scopes with implication closure and contradiction
  detection;
- the scalar domain lattice `integer ⊆ rational ⊆ real ⊆ complex`;
- strict `require()` behavior and conditional obligation emission;
- semantic operator/function records in the instance-local registry;
- domain-aware definedness analysis over MathJS nodes;
- adapters between the new predicates and the existing public solver `Condition`
  model;
- migration of `SymbolicKernel.conditionsForDefinedness()` and condition
  contradiction checks onto the new semantic layer.

No new equation class, solver stage, dispatch order, or `SolveResult` variant is
introduced.

## Initial inference boundary

The Chapter 2 inference system is intentionally conservative:

- domain and property implications are admitted only when encoded explicitly;
- unknown facts remain unknown rather than being guessed from names or formatting;
- successful evaluation may establish facts for a configured MathJS instance;
- unregistered custom functions remain opaque unless they evaluate with the
  supplied scope or their definedness is assumed;
- negative assumptions disprove narrower implications, such as `not real`
  disproving `integer`;
- strict mode rejects an unproved requirement, while conditional mode returns the
  requirement as an explicit obligation.

Predicate expression identity is provisional and structural. Chapter 3 replaces its
implementation with the common structural fingerprint service without changing the
predicate contract.

## Regression risks and verification

| Risk | Verification |
|---|---|
| The domain lattice proves an invalid widening or narrowing | Exhaustive domain implication tests cover all initial levels and negative facts. |
| Sign and parity implications hide contradictions | Direct, implied, pairwise, and combined contradiction tests cover zero/nonzero, sign partitions, parity, and domain negation. |
| Scoped assumptions mutate a parent operation | Persistent extension tests prove parent size and judgments remain unchanged. |
| Constants are classified from JavaScript representation too aggressively | Number, BigNumber, Fraction, Complex, `pi`, and `i` cases verify conservative 3-valued results. |
| MathJS custom functions leak global semantics | Per-instance tests keep opaque functions unknown unless evaluation or assumptions supply evidence. |
| Definedness differs between real and complex domains | Root, logarithm, division, power, and opaque-function tests exercise both domains. |
| Legacy solver conditions change during migration | Kernel compatibility tests preserve condition ordering and normalization, and focused solver/conformance tests compare semantic outputs. |
| Registry records make unsupported functions appear known | Every unregistered function defaults to `opaque`; registered semantic records are immutable and instance-local. |

## Test scope

The chapter gate runs the new focused tests plus every solver family that directly
consumes `SymbolicKernel` conditions or verification:

```text
test/assumptions.spec.ts
test/semantic-predicates.spec.ts
test/symbolic-context.spec.ts
test/kernel.spec.ts
test/isolate.spec.ts
test/polynomial.spec.ts
test/cubic.spec.ts
test/quartic.spec.ts
test/complex-polynomial.spec.ts
test/trigonometric.spec.ts
test/compound-trigonometric.spec.ts
test/numeric-solve.spec.ts
test/conformance.spec.ts
test/migration-baseline.spec.ts
test/solver-contract.spec.ts
npm run typecheck
npm run build
npm run test:pack
```

The remaining unrelated test files, coverage threshold pass, and performance
benchmark are intentionally omitted because Chapter 2 does not change solver
algorithms, numerical backends, parsing, serialization, or dispatch. The complete
gate remains required at Chapter 8 and before publishing.
