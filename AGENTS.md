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

Targeted tests are the fast feedback loop while developing. They do not replace the full gate that runs before every commit.

In the handoff, state the impact mapped, tests run, tests intentionally omitted, and the reason the selected regression scope was sufficient. Never imply an unrun test passed.

## Full verification before every commit

The complete verification and regression suite is local. No GitHub workflow runs it.

Every commit must pass the full `npm run check` gate. The tracked hooks in `.githooks/` enforce this:

1. Run `npm install` (or `npm ci`) once per clone. Its `prepare` script sets `git config core.hooksPath .githooks`. Confirm with `git config core.hooksPath`.
2. Stage everything that belongs in the commit. The hook refuses to run while unstaged or untracked changes are present, so the gate tests exactly the committed files. Stash unrelated work first.
3. Run `git commit` as usual. The `pre-commit` hook (and `pre-merge-commit` for merges) runs `npm run check`, which covers typecheck, coverage, build, benchmarks, packed-consumer verification, and release metadata. It blocks the commit on any failure.
4. On failure, fix the cause, re-stage, and commit again. Never bypass the gate with `--no-verify`, and never weaken tests or coverage thresholds to get a commit through.

`git cherry-pick` and `git rebase` do not run `pre-commit` for replayed commits. Run `npm run check` manually before pushing their results.

## Versioning and publishing

- Every commit on `main` bumps the patch version automatically. The `pre-commit` hook runs `npm version patch --no-git-tag-version` and stages `package.json` and `package-lock.json`, unless the commit already changes the version (for a deliberate minor or major bump, set it yourself before committing). Commits on other branches do not bump.
- Land branch work on `main` with a merge commit (`git merge --no-ff <branch>`) or a squash commit (`git merge --squash <branch>`, then `git commit`), so the hook bumps the version. For a merge commit, `pre-merge-commit` stages the bump and stops the merge, because git would otherwise leave the bump out of the merge commit. Run `git commit` to complete it; the full gate runs then. A fast-forward merge creates no commit, so it neither bumps nor publishes.
- Amending a commit on `main` bumps the version again. That is harmless before pushing; never amend or rewrite commits that are already pushed.
- `.github/workflows/publish.yml` runs on every push to `main`. If the version at the pushed tip is not yet on npm, it runs a packaging safety net (`test:release`, `build`, `test:pack`), publishes with provenance, and creates the `v<version>` tag and GitHub Release. Only the tip of each push is published, so pushing several commits at once skips the intermediate version numbers.
- Do not add test, coverage, or benchmark jobs to GitHub workflows. `npm run test:release` enforces this.
