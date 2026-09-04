# Repository agent instructions

## Map change impact before editing

For every implementation, refactor, workflow, packaging, or public-documentation change:

1. Identify the behavior being changed and the files that own it.
2. Trace direct callers, imports, exports, public types, serialization formats, fixtures, documentation examples, and release/package surfaces that could be affected.
3. Record the concrete regression risks before choosing tests.
4. Select tests that directly exercise each risk; do not default to the entire suite merely because it exists.

Revisit the impact map when implementation reveals additional dependencies or changes the intended behavior.

## Use targeted regression tests during development

Run the smallest test set that can credibly detect regressions from the mapped impact:

- Use `npx vitest run <affected test files>` for focused runtime behavior.
- Run `npm run typecheck` when TypeScript contracts, exports, factories, or result types change.
- Run `npm run build` when production compilation, generated declarations, or package exports may change.
- Run `npm run test:benchmark` only for algorithmic or performance-sensitive changes.
- Run `npm run test:pack` for package contents, exports, peer dependencies, or consumer-install changes.
- Run `npm run test:release` for versions, release metadata, or GitHub workflow changes.

Run the complete `npm run check` gate for cross-cutting symbolic-core changes, solver-dispatch changes with broad reach, release preparation, explicit user requests, or when the impact cannot be bounded confidently. Documentation-only changes do not require the full gate unless they alter executable examples, package contents, or release metadata.

In the handoff, state the impact mapped, tests run, tests intentionally omitted, and the reason the selected regression scope was sufficient. Never imply an unrun test passed.

## Full release verification

`.github/workflows/ci.yml` is the reusable and manually dispatchable full verification matrix. It must not acquire automatic `push` or `pull_request` triggers.

`.github/workflows/publish.yml` first checks whether the current `main` version is absent from npm. Only an unpublished version calls the full verification matrix, and publishing must remain dependent on that successful verification. Ordinary commits and pull requests should rely on the targeted regression testing described above rather than automatically running the full matrix.
