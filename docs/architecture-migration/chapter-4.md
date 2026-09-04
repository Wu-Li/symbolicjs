# Chapter 4 — Canonicalization engine

## Status

Implemented on `feat/mathjs-symbolic-layer`. This chapter introduces bounded,
profile-driven canonicalization over MathJS nodes without adding equation families or
changing solver dispatch.

## Impact map

Chapter 4 adds `math.symbolic.canonicalize(node, options)` and the internal
`CanonicalizationEngine`. The implementation owns:

- syntax-only structural normalization;
- scalar associative and commutative normalization when scalar semantics are proven;
- conditional normalization with explicit predicates when callers permit obligations;
- exact constant folding through the configured MathJS instance;
- deterministic coefficient, sign, identity, subtraction, and operand ordering;
- real-only square-root-of-square normalization under real/sign evidence;
- conservative complex-safe behavior for branch-sensitive powers and logarithms;
- immutable transformation traces and typed pass, node, and rewrite limits;
- canonical rebuilding of `EqualityNode` and supported generic MathJS nodes;
- canonical structural keys behind `SymbolicKernel.canonicalKey()`.

The affected legacy consumers are the polynomial, isolation, compound-trigonometric,
and parametric paths that use `canonicalKey()` for deduplication. Their public APIs and
solver dispatch remain unchanged.

## Profiles and safety boundary

| Profile | Contract |
|---|---|
| `structural` | Removes redundant parentheses and unary plus, normalizes exact signed constants, and rebuilds children without algebraic reordering. |
| `scalar` | Adds exact scalar identities, subtraction/sign normalization, associative flattening, deterministic commutative ordering, and configured exact constant folding. |
| `real-algebraic` | Uses the scalar rules plus transformations justified only in the real domain, initially `sqrt(x^2)`/`nthRoot(x^2, 2)`. |
| `complex-safe` | Uses only scalar transformations valid under MathJS complex semantics without combining multivalued powers or logarithms. |
| `presentation` | Uses scalar canonical structure and emits stable unary-minus presentation where justified. |

Unknown scalar facts block a rewrite in strict mode. Conditional mode performs the
same rewrite only while returning the unresolved predicates. Rewrites that could hide
an undefined operand, such as `0*x -> 0` or `1^x -> 1`, additionally require
explicit definedness evidence. The engine intentionally does not call MathJS's broad
permissive simplifier or perform distributive expansion.

## Regression risks and verification

| Risk | Verification |
|---|---|
| Matrix or custom values are reordered as scalars | Strict unknown-symbol and matrix-scope tests prove order is preserved; real assumptions and conditional predicates enable scalar ordering deliberately. |
| Real identities leak into complex canonicalization | Real and complex profile tests compare `sqrt(x^2)` and exact complex constants. |
| Identity or annihilator rules hide undefined expressions | Strict/conditional tests cover additive and multiplicative identities, `0*x`, `1^x`, `x^0`, `0^0`, and an invalid denominator. |
| Branch-sensitive transformations are introduced accidentally | Regression cases preserve `x/x`, `(x*y)^a`, `x^a*x^b`, and logarithm combinations. |
| Configured numeric types are coerced through JavaScript numbers | BigNumber and Fraction tests assert configured result values and exactness. |
| Canonicalization oscillates or expands indefinitely | Every profile has idempotence tests and typed pass, node, and rewrite limits. |
| Generic/custom nodes corrupt trace state when rebuilding fails | Generic-node and rollback/cycle tests preserve opaque nodes and deterministic diagnostics. |
| Legacy solver deduplication changes solutions | Kernel, parametric, polynomial, isolation, compound-trigonometric, migration-baseline, and solver-contract tests exercise canonical-key consumers. |
| Package declarations or consumer installation omit the new service | Type fixture, build, and packed-consumer verification call `math.symbolic.canonicalize()`. |

## Test scope

Focused development verification:

```text
test/canonicalize.spec.ts
test/canonicalize-hardening.spec.ts
test/symbolic-core-hardening.spec.ts
test/kernel.spec.ts
test/parametric.spec.ts
test/polynomial.spec.ts
test/isolate.spec.ts
test/compound-trigonometric.spec.ts
test/migration-baseline.spec.ts
test/solver-contract.spec.ts
npm run typecheck
npm run build
npm run test:pack
```

Because canonicalization changes the shared symbolic core and the legacy identity
facade used by several solvers, the final chapter gate also runs `npm run check`,
including coverage, all solver tests, benchmarks, packaging, and release validation.

## Exit result

Canonicalization now provides deterministic, idempotent, assumption-aware MathJS AST
forms and explicit conditional obligations. Algebraic expansion, polynomial/rational
views, and richer coefficient collection remain Chapter 5 responsibilities.
