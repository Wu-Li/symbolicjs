# Chapter 6 — Typed pattern matching with semantic predicates

## Status

Implemented on `feat/mathjs-symbolic-layer-chapter-6`.

## Impact map

Chapter 6 introduces:

- typed pattern combinators for literals, captures, repeated captures, operators, functions, alternatives, optional forms, and rest operands;
- semantic guards backed by Chapter 2 predicates and Chapter 5 algebra analysis;
- deterministic ordered matching;
- bounded associative/commutative matching over flattened operands;
- immutable bindings and accumulated conditional requirements;
- the `math.symbolic.match()` entry point and `math.symbolic.matcher` service;
- public exports for pattern construction and matcher result types.

Existing solvers are not migrated in this chapter.

## Regression risks and verification

| Risk | Verification |
|---|---|
| Repeated captures compare formatted text instead of structural identity | Repeated-capture tests use Chapter 3 structural comparison. |
| Unknown semantic facts are treated as permission | Strict-mode guard tests must decline unknown predicates; conditional mode records requirements. |
| Associative/commutative matching becomes unbounded | Every candidate branch charges `matchBranches`; exhaustion returns a typed limit result. |
| Operand permutations produce unstable bindings | Commutative permutation tests assert deterministic capture order. |
| Variadic matching drops unmatched operands | Rest-capture tests assert complete leftover capture. |
| Algebraic recognizer logic is duplicated in the matcher | `affine-in`, `polynomial-in`, and `rational-in` delegate to Chapter 5 views. |
| New public matcher contracts break package compilation | Typecheck, production build, and packed-consumer verification cover exports and declarations. |

## Focused verification

```text
npx vitest run test/pattern-matcher.spec.ts
npm run typecheck
npm run build
npm run test:pack
```

The full `npm run check` gate is intentionally deferred because Chapter 6 adds a bounded core service without migrating solver dispatch or other cross-cutting solver behavior. Chapter 8 remains the next required full-check integration gate unless implementation impact broadens before then.

## Exit gate

Typed patterns can deterministically match structural and semantically guarded MathJS expressions, including bounded associative/commutative forms, while returning immutable bindings and preserving unresolved obligations.