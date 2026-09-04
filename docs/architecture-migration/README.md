# MathJS-native symbolic-layer migration baseline

The architecture migration starts from commit
`f37f1636689c382cc514d29cc168d0aa010baee7` and package version `0.5.3`.
Production solver behavior at that commit is the compatibility baseline while the
shared symbolic layer is built underneath it.

## Chapter status

| Chapter | Status |
|---|---|
| 0 — baseline and migration harness | Complete |
| 1 — MathJS integration substrate and operation context | Complete |
| 2 — assumptions, domains, predicates, and definedness | Complete |
| 3 — structural identity, ordering, fingerprints, and cost | Complete |
| 4 — canonicalization engine | Complete |
| 5–14 | Not started |

## Scope freeze

Chapters 0 through 14 restructure existing capabilities. They must not add new
equation families merely to demonstrate the infrastructure. New equation classes
resume only after the Chapter 14 integration gate passes.

## Impact map

Chapter 0 changes test support, measurement scripts, and documentation only. It does
not alter `src/` production algorithms or public exports. Chapter 1 adds the
instance-local symbolic substrate and adapts legacy solver budgets, without changing
solver algorithms or dispatch. Chapter 2 adds the immutable assumptions,
domain, predicate, definedness, and semantic-inference layer while preserving
the existing solver contracts through compatibility adapters. Chapter 3
centralizes lossless structural identity, deterministic ordering, fingerprints,
and syntax-aware expression cost. Chapter 4 adds bounded, idempotent,
assumption-aware canonicalization profiles over MathJS nodes and routes the legacy
canonical-key facade through the shared canonical structural identity.

Affected surfaces:

- public export inventory and public type fixture;
- semantic compatibility fixtures for every `SolveResult` kind;
- package contents because `docs/architecture-migration/` is published;
- benchmark and package-size measurement tooling;
- future chapters, which will maintain the machine-readable module map;
- the configured MathJS instance, which now exposes experimental semantic,
  structural, and canonicalization services through `math.symbolic`.

Primary risks and regression coverage:

| Risk | Verification |
|---|---|
| Public exports drift unnoticed | The inventory test compares runtime exports and parsed type exports with `public-api.json`. |
| New or removed source modules escape the migration map | The module-map test compares every `src/**/*.ts` file with `module-map.json`. |
| Later migrations preserve result kinds but change meaningful semantics | The semantic summarizer and dual-run harness compare stable, order-independent summaries. |
| Fixtures become invalid or ambiguous | The loader rejects malformed records and duplicate case IDs. |
| Baseline tooling changes package contents unexpectedly | The packed-consumer test remains part of the full gate. |
| Benchmarks become anecdotal | Named measurements and node-count metrics are committed in `baseline-metrics.json`. |
| New symbolic state leaks between MathJS instances | Chapter 1 creates and tests an independent adapter, registry, and operation context per instance. |

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
- `mathjs-api-boundary.md`: direct MathJS dependencies permitted for the new core.
- `chapter-1.md`: Chapter 1 impact map and focused verification scope.
- `chapter-2.md`: Chapter 2 semantic contracts, risks, and focused gate.
- `chapter-3.md`: Chapter 3 structural identity, ordering, cost, and test scope.
- `chapter-4.md`: Chapter 4 canonicalization contracts, safety boundaries, and test scope.

Regenerate measurements after a build with:

```sh
npm run measure:architecture-baseline -- docs/architecture-migration/baseline-metrics.json
```

Measurements are evidence for trend analysis, not exact CI snapshots. Functional
compatibility remains enforced by tests.
