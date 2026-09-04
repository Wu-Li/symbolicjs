# Chapter 1 — MathJS integration substrate and operation context

## Status

Implemented on the `feat/mathjs-symbolic-layer` branch. Existing equation-solving
behavior remains owned by the legacy solver modules.

## Impact map

Chapter 1 adds the instance-local substrate used by later architecture chapters:

- `MathAdapter` defines the supported MathJS service boundary;
- `NodeBuilder` creates nodes through constructors from the configured instance;
- `SymbolicRegistry` stores immutable operator and function metadata;
- `OperationBudget` and `OperationContext` provide operation-neutral limits,
  memoization, diagnostics, assumptions/domain placeholders, and strict or
  conditional mode;
- `math.symbolic` exposes the experimental context while `math.symbolicKernel`
  remains unchanged;
- `SolverContext` now adapts operation-neutral budgets back to the existing public
  `LimitResult` contract.

The root package export list is unchanged. The `symbolicjsInstance` type and packed
runtime gain the `math.symbolic` property.

## Regression risks and verification

| Risk | Verification |
|---|---|
| State leaks between configured MathJS instances | Separate instances import different constants/functions and prove adapter and registry isolation. |
| Nodes are created with the wrong constructors | Builder tests use `instanceof` against each configured instance and round-trip an `EqualityNode` through that instance's reviver. |
| Number configuration crosses contexts | Number, BigNumber, Fraction, and Complex values are built and evaluated independently. |
| Generic budgets change legacy solver limits | `test/solver-contract.spec.ts` exercises every existing limit and the new context tests exhaust limits independently. |
| Factory dependencies expand invisibly | The exact dependency list is frozen in code, documentation, and a focused assertion. |
| The new public instance property is missing from the package | Type fixture and packed-consumer verification access `math.symbolic`. |
| Solver behavior changes despite the substrate-only scope | The Chapter 0 semantic baseline and focused solver contract remain unchanged. |

## Test scope

The chapter gate runs:

```text
test/symbolic-context.spec.ts
test/equality-node.spec.ts
test/solver-contract.spec.ts
test/migration-baseline.spec.ts
npm run typecheck
npm run build
npm run test:pack
```

The complete solver suite and performance benchmark are intentionally omitted for
this chapter because no solver algorithm or dispatch path changes. Full integration
verification remains scheduled at Chapter 8 and before publishing.

Candidate package and production-JavaScript measurements are recorded in
`test/fixtures/architecture-migration-chapter-1-metrics.json`; the fixture is test
infrastructure and is not included in the npm package.
