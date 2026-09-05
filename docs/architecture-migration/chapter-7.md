# Chapter 7 — Transformation rules and bounded strategies

## Status

Implementation and focused regression tests are committed on
`feat/mathjs-symbolic-layer-chapter-7`. Runtime verification is still pending because
the current execution environment cannot reach GitHub/npm to check out dependencies;
do not treat the commands below as having passed until they are actually run.

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
- `math.symbolic.rewrite` and `math.symbolic.transform()` entry points;
- reusable foundational arithmetic/sign/denominator/power rules that are safe
  without unstated scalar assumptions;
- the compound-trigonometric parity, Pythagorean, and product-to-angle facts from the
  existing solver expressed as typed rule data without migrating the solver itself.

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
| Generic rule packs diverge from existing compound-trig normalization | Focused tests exercise cosine parity, the Pythagorean identity, and the sin/cos product rule through the generic strategy engine. |
| Public exports or module inventory drift | Migration inventory tests cover `src/index.ts`, `public-api.json`, and `module-map.json`. |

## Focused verification to run

```text
npx vitest run test/rewrite-engine.spec.ts test/pattern-matcher.spec.ts
npx vitest run test/compound-trigonometric.spec.ts test/migration-baseline.spec.ts
npm run typecheck
npm run build
npm run test:pack
```

Chapter 7 is not an integration-gate chapter in the implementation plan, so
`npm run check` is not required unless focused verification exposes broader impact.

## Exit gate

Chapter 7 is complete only after the focused commands above pass. At that point the
package can orchestrate reusable, requirement-preserving algebraic transformations
independently of equation solving, and Chapter 8 may begin.
