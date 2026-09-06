# Chapter 8 — Equivalence and verification

## Status

Complete and verified on `feat/mathjs-symbolic-layer-chapter-8`.

## Impact map

Chapter 8 introduces:

- a conservative staged equivalence engine covering structural identity,
  canonical forms, polynomial equality, and rational equality with preserved
  denominator requirements;
- `math.symbolic.equivalent()` as the MathJS-native equivalence entry point;
- a shared substitution-verification service exposed as
  `math.symbolic.verifySubstitution()`;
- symbolic proof before numeric evidence, with sampled agreement remaining
  inconclusive and sampled counterexamples permitted to reject candidates;
- configured-instance evaluation through `MathAdapter`, including function-aware
  sampling that excludes MathJS function identifiers from free-variable scopes;
- compatibility preservation for the existing `SymbolicKernel.verify()` solver
  contract;
- additional integration coverage for matcher/rewrite bounded paths required by
  the Chapter 8 full-suite coverage gate;
- Node 26 plus latest-compatible MathJS as the repository's single verification
  environment;
- verification on every pushed commit and npm publication gated by a published
  GitHub Release.

Existing solver result contracts and solver dispatch remain unchanged.

## Regression risks and verification

| Risk | Verification |
|---|---|
| Algebraically equivalent expressions are rejected because their syntax differs | Equivalence tests cover structural, canonical, polynomial, and rational proof stages. |
| Rational proofs silently discard denominator obligations | Rational-equivalence tests require nonzero-denominator requirements to survive the proof. |
| Numeric sampling is mistaken for proof | Verification tests require sampled agreement to remain `inconclusive` with `numeric-evidence-only`. |
| False parameterized candidates survive because symbolic proof is unavailable | Sampled counterexamples reject parameterized false candidates. |
| MathJS function names are sampled as variables and shadow the configured namespace | Regression coverage verifies `sqrt(a^2)` versus `abs(a)` with only actual free symbols sampled. |
| Numeric verification bypasses the configured MathJS instance | `MathAdapter` receives the configured evaluator and verification exercises normal and BigNumber configurations. |
| The new verification layer changes established solver behavior | `SymbolicKernel.verify()` retains the Chapter 7 compatibility implementation and the full legacy solver suite passes. |
| Chapter 6/7 integration paths reduce global coverage below the repository gate | Chapter 8 integration tests cover bounded matcher and rewrite strategy branches without lowering thresholds. |
| Workflow simplification weakens release safety | Every push runs `npm run check`; publication runs only for a published GitHub Release and re-verifies the released revision before npm publish. |

## Verification

Full verification run `34058351790` completed successfully on commit
`126419f4f7dbcca2eb3cd43c1f000be3f23aaa7e` using Node 26 and the latest compatible
MathJS 15.x release.

The gate runs:

```text
npm run typecheck
npm run test:coverage
npm run build
npm run test:benchmark
npm run test:pack
npm run test:release
```

The final pre-record run passed the complete functional suite and repository coverage
thresholds. The focused Chapter 8 verification gate also passed during the final fix
sequence, including equivalence, shared verification, kernel compatibility, build,
packed-consumer, and release-metadata checks.

## Exit gate

The Chapter 8 equivalence and verification layer is integrated without replacing the
existing solver verification contract. The full repository verification gate is green,
including coverage, packaging, and release checks. Chapter 8 is complete.
