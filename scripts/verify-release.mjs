import assert from 'node:assert/strict';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));
const publish = read('.github/workflows/publish.yml');
const hook = read('scripts/git-hooks/pre-commit.mjs');

// Version metadata.
assert.match(packageJson.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
assert.equal(packageLock.version, packageJson.version);
assert.equal(packageLock.packages[''].version, packageJson.version);

// Full verification is local only: no workflow runs the test suite.
for (const removed of ['ci.yml', 'chapter-verification.yml']) {
  assert.ok(
    !existsSync(resolve(root, '.github/workflows', removed)),
    `.github/workflows/${removed} must not exist; full verification runs locally`
  );
}

// Local gate: tracked hooks, installed by `prepare`, run the full check.
assert.equal(packageJson.scripts.prepare, 'node scripts/install-git-hooks.mjs');
assert.match(read('scripts/install-git-hooks.mjs'), /core\.hooksPath', '\.githooks'/);
for (const name of ['pre-commit', 'pre-merge-commit']) {
  const path = resolve(root, '.githooks', name);
  const expected = name === 'pre-merge-commit'
    ? /node scripts\/git-hooks\/pre-commit\.mjs merge$/m
    : /node scripts\/git-hooks\/pre-commit\.mjs$/m;
  assert.match(read(`.githooks/${name}`), expected);
  if (process.platform !== 'win32') {
    assert.ok(statSync(path).mode & 0o111, `.githooks/${name} must be executable`);
  }
}
assert.match(hook, /\['run', 'check'\]/);
assert.match(hook, /=== 'main'/);
assert.match(hook, /'version', 'patch', '--no-git-tag-version'/);
assert.match(hook, /'ls-files', '--others', '--exclude-standard'/);
assert.match(hook, /process\.argv\[2\] === 'merge'/);

// Publishing: pushes to main publish an unpublished version after a safety net.
assert.match(publish, /^ {2}push:\s*\n {4}branches: \[main\]/m);
assert.match(publish, /workflow_dispatch:/);
assert.doesNotMatch(publish, /^ {2}(?:pull_request|release|workflow_call):/m);
assert.match(publish, /github\.ref == 'refs\/heads\/main'/);
assert.match(publish, /contents:\s*write/);
assert.match(publish, /id-token:\s*write/);
assert.match(publish, /group:\s*npm-publish-main/);
assert.match(publish, /cancel-in-progress:\s*false/);
assert.match(publish, /node-version:\s*26/);
assert.match(
  publish,
  /npm view "\$\{PACKAGE_NAME\}@\$\{PACKAGE_VERSION\}" version/
);
assert.match(publish, /registry_status=\$\?/);
assert.match(publish, /grep -q 'E404'/);
assert.match(publish, /exit "\$registry_status"/);
assert.doesNotMatch(publish, /npm run (?:check|test:coverage|test:benchmark)\b/);
assert.doesNotMatch(publish, /npm (?:run )?test\s*$/m);

// Every step after the registry check is skipped when the version is already published.
const steps = publish.split(/\n {6}- name: /).slice(1);
const gated = steps.filter((step) => !/^(?:Read package identity|Check npm registry)/.test(step));
assert.ok(gated.length > 0);
for (const step of gated) {
  assert.match(
    step,
    /if: steps\.registry\.outputs\.published == 'false'/,
    `publish step is not gated on an unpublished version: ${step.split('\n')[0]}`
  );
}

const order = [
  'npm ci',
  'npm run test:release',
  'npm run build',
  'npm run test:pack',
  'npm publish --provenance --access public',
  'gh release create "v${PACKAGE_VERSION}"'
].map((command) => {
  const index = publish.indexOf(command);
  assert.notEqual(index, -1, `publish workflow omits: ${command}`);
  return index;
});
assert.deepEqual(order, [...order].sort((a, b) => a - b), 'publish steps are out of order');
