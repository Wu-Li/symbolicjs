# Chapter 7 — Transformation rules and bounded strategies

## Status

Complete and verified on `feat/mathjs-symbolic-layer-chapter-7`.

## Impact map

Chapter 7 introduces:

- immutable `RewriteRule` contracts with stable IDs, descriptions, typed patterns,
  replacement builders, cost direction, domain/profile metadata, and provenance;
- strategy combinators for single-rule application, top-down and bottom-up traversal,
  ordered choice, sequence, fixed-point repetition, cost-based best-of selection,
  bounded best-first search, and deterministic branch/merge selection;
- Chapter 3 fingerprints for cycle detection and Chapter 3 cost comparison for
  deterministic result selection;
- bounded rewrite steps, branches, states, frontier size, matcher backtracking, and
  expression-node growth;
- mandatory propagation of matcher requirements into transformation results and
  trace steps;
- `math.symbolic.rewrite` plus the convenience entry point
  `math.symbolic.rewriteExpression()`;
- reusable foundational arithmetic/sign/denominator/power rules that are safe
  without unstated scalar assumptions;
- the compound-trigonometric parity, Pythagorean, and product-to-angle facts from the
  existing solver expressed as typed rule data without migrating the solver itself.

MathJS reserves a factory result's `transform` function property for expression
parser transforms and rejects factory-produced objects that expose one. Therefore the
provisional `math.symbolic.transform()` name from the architecture sketch is not a
supported MathJS factory boundary; `rewriteExpression()` preserves the planned
capability while remaining MathJS-native and instance-local.

Existing solver dispatch and solver implementations remain authoritative in this
chapter.

## Regression risks and verification

| Risk | Verification |
|---|---|
| Rules mutate caller-owned MathJS nodes | Rewrite tests preserve and compare the original input after transformation. |
| Fixed-point strategies oscillate between inverse rules | Deliberate `x -> y -> x` cycle test requires visited-state termination. |
| Conditional rules lose domain obligations | Guarded cancellation test requires strict rejection and conditional requirement preservation. |
| Search/branching becomes unbounded | Typed limits cover steps, rewrite branches, matcher AC branches, states, frontier size, and node growth. |
| Cost-guided selection becomes nondeterministic | `bestOf` test presents candidates in reverse preference order and requires the lower-cost result. |
| Traversal misses nested expressions | Top-down fixed-point test normalizes nested additive identities under a function. |
| Generic rule packs diverge from existing compound-trig normalization | Focused rewrite tests exercise cosine parity, the Pythagorean identity, and the sin/cos product rule through the generic strategy engine. |
| Public exports or module inventory drift | Migration baseline tests cover `src/index.ts`, `public-api.json`, and `module-map.json`. |
| A symbolic convenience method collides with MathJS parser-transform semantics | Runtime construction through `importsymbolicjs()` is exercised before every rewrite and migration-baseline assertion. |

## Verification

GitHub Actions Chapter verification run `33991959770` completed successfully on the
Chapter 7 implementation. It ran:

```text
npm run typecheck
npx vitest run test/rewrite-engine.spec.ts test/migration-baseline.spec.ts
npm run build
npm run test:pack
npm run test:release
```

Chapter 6 was independently verified by Chapter verification run `33991826140`,
including its matcher-focused test and migration-baseline suites.

Chapter 7 is not an integration-gate chapter in the implementation plan, so the full
`npm run check` matrix is intentionally deferred to Chapter 8.

## Exit gate

The targeted verification gate is green. SymbolicJS can orchestrate reusable,
requirement-preserving algebraic transformations independently of equation solving,
and Chapter 8 may begin.
