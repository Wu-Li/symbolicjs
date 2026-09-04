# MathJS-native symbolic-layer migration baseline

The architecture migration starts from commit
`f37f1636689c382cc514d29cc168d0aa010baee7` and package version `0.5.3`.
Production solver behavior at that commit is the compatibility baseline while the
shared symbolic layer is built underneath it.

## Scope freeze

Chapters 0 through 14 restructure existing capabilities. They must not add new
equation families merely to demonstrate the infrastructure. New equation classes
resume only after the Chapter 14 integration gate passes.

## Impact map

Chapter 0 changes test support, measurement scripts, and documentation only. It does
not alter `src/` production algorithms or public exports.

Affected surfaces:

- public export inventory and public type fixture;
- semantic compatibility fixtures for every `SolveResult` kind;
- package contents because `docs/architecture-migration/` is published;
- benchmark and package-size measurement tooling;
- future chapters, which will maintain the machine-readable module map.

Primary risks and regression coverage:

| Risk | Verification |
|---|---|
| Public exports drift unnoticed | The inventory test compares runtime exports and parsed type exports with `public-api.json`. |
| New or removed source modules escape the migration map | The module-map test compares every `src/**/*.ts` file with `module-map.json`. |
| Later migrations preserve result kinds but change meaningful semantics | The semantic summarizer and dual-run harness compare stable, order-independent summaries. |
| Fixtures become invalid or ambiguous | The loader rejects malformed records and duplicate case IDs. |
| Baseline tooling changes package contents unexpectedly | The packed-consumer test remains part of the full gate. |
| Benchmarks become anecdotal | Named measurements and node-count metrics are committed in `baseline-metrics.json`. |

## Compatibility policy

Compatibility checks are divided deliberately:

- **Exact string contracts** cover syntax owned by SymbolicJS, currently the
  canonical `=:=` equation rendering. These cases are listed explicitly in the
  migration fixture.
- **Semantic contracts** cover solver results. Solution and family ordering is
  ignored; the comparison preserves result kind, target, completeness, scope,
  counts, condition kinds, exactness, verification status, multiplicity, and typed
  failure reasons.
- **Presentation is not semantics.** Algebraically equivalent expression strings
  are not frozen as a broad contract. Structural and semantic equivalence become
  stronger in Chapters 3 and 8.

## Baseline artifacts

- `public-api.json`: every public value and type export at the baseline.
- `module-map.json`: every current production module and its intended destination.
- `baseline-metrics.json`: packed size, built JavaScript bytes, selected timing
  measurements, and peak output-node counts.
- `test/fixtures/architecture-migration-baseline.json`: representative compatibility
  cases for all public result kinds.

Regenerate measurements after a build with:

```sh
npm run measure:architecture-baseline -- docs/architecture-migration/baseline-metrics.json
```

Measurements are evidence for trend analysis, not exact CI snapshots. Functional
compatibility remains enforced by tests.
