# Chapter 3 — Structural identity, ordering, fingerprints, and cost

## Status

Implemented on the `feat/mathjs-symbolic-layer` branch. This chapter defines
syntax-level structure only; algebraic canonicalization and equivalence remain the
responsibility of Chapters 4 and 8.

## Impact map

Chapter 3 adds shared structural services over MathJS nodes:

- a lossless deterministic key that preserves node kinds, operator/function
  metadata, configured numeric representations, `-0`, non-finite values, arrays,
  objects, and custom-node JSON;
- explicit parenthesis-preserving and parenthesis-transparent policies;
- a compact deterministic fingerprint used only as an acceleration hint, never as
  collision-free identity;
- a total structural order with stable node-kind precedence and key tie-breaking;
- immutable syntax-cost metrics and configurable weighted scores;
- target occurrence, function depth, division, power, arity, leaf, and symbol
  metrics;
- operation-local memoization for repeated structural analysis;
- migration of predicate identity from its provisional serializer to the common
  structural key;
- `math.symbolic.structure` as the instance-local access point;
- hardening for configured Fraction exponents, invalid operation scopes, and
  custom MathJS nodes that expose no `toJSON()` method.

The chapter does not reorder, simplify, evaluate, or canonicalize expressions. It
does not assume that commutative operands may be exchanged. Those transformations
begin in Chapter 4 and require Chapter 2 semantic evidence.

## Identity contract

`StructuralEngine.equals()` means that two MathJS expression trees carry the same
serialized node structure under the selected parenthesis policy. It is stronger
than matching formatted text and much weaker than algebraic equivalence.

Fingerprints use the versioned `s1-` format. A fingerprint match is not proof of
identity; authoritative callers compare the structural key after a hash match.
Object-record keys are sorted because object property order is not expression
semantics. Array order, operator implicitness, node types, and configured numeric
representations remain significant.

## Cost contract

Expression cost is deterministic syntax metadata, not a mathematical measure of
simplicity. The default score combines:

- node count;
- maximum depth;
- operator and function counts;
- explicit division and power counts;
- optional target-symbol occurrences.

Every component and weight is retained in the returned object. Later transformation
strategies may define task-specific weights rather than treating the default score
as a universal normal form.

## Regression risks and verification

| Risk | Verification |
|---|---|
| Formatted expressions collide despite different AST semantics | Explicit and implicit multiplication, `0` and `-0`, array order, and node-type cases must produce different keys. |
| Equivalent trees from separate MathJS instances receive different keys | Cross-instance parse and configured-node tests compare keys and fingerprints. |
| Parentheses produce inconsistent equality and ordering | Both policies assert `equals()` and `compare()` agree. |
| Object insertion order destabilizes persistence | Reordered object literals must share a key while arrays remain ordered. |
| Fingerprints are treated as authoritative | API documentation and tests retain structural keys alongside fingerprints. |
| Cost changes caller-owned nodes | JSON snapshots and traversal spies prove analysis is read-only. |
| Cost or ordering becomes nondeterministic | Repeated, cross-instance, antisymmetry, transitivity, and tie-break tests cover deterministic behavior. |
| Deep or oversized inputs exhaust resources | Configurable maximum depth and node-count tests fail explicitly. |
| Predicate assumptions stop matching separately parsed equivalent nodes | Assumption tests exercise predicate identity through the shared structural key. |
| Existing solving changes during a structural-only chapter | Migration baseline, kernel, solver-contract, and complete repository tests remain unchanged. |
| New core branches reduce the established quality gate below threshold | Edge-case tests exercise validation, configured numeric types, semantic inference, definedness, custom-node serialization, and cyclic inputs; the complete coverage gate is then run. |
| Invalid scopes are silently normalized by object spread | Direct operation-context validation rejects arrays before merging inherited defaults. |
| Fraction-valued exponents evade real-domain obligations | Configured Fraction exponents are converted through their supported value interface and emit the expected nonnegative requirement. |
| A custom node without `toJSON()` recursively serializes its own `isNode` marker | Fallback serialization excludes the marker and remains deterministic for public fields. |

## Test scope

Focused development checks run:

```text
test/structure.spec.ts
test/symbolic-core-hardening.spec.ts
test/assumptions.spec.ts
test/semantic-predicates.spec.ts
test/symbolic-context.spec.ts
test/kernel.spec.ts
test/migration-baseline.spec.ts
test/solver-contract.spec.ts
npm run typecheck
npm run build
npm run test:pack
```

Because Chapters 2 and 3 add cross-cutting symbolic-core production modules, the
final chapter gate also runs the complete repository command:

```text
npm run check
```

That gate includes all tests with the established coverage thresholds, production
build, benchmarks, packed-consumer verification, and release-workflow validation.
No regression category is intentionally omitted from the final gate.
