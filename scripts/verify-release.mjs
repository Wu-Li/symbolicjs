import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));
const changelog = read('CHANGELOG.md');
const ci = read('.github/workflows/ci.yml');
const publish = read('.github/workflows/publish.yml');

assert.match(packageJson.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
assert.equal(packageLock.version, packageJson.version);
assert.equal(packageLock.packages[''].version, packageJson.version);
assert.match(changelog, new RegExp(`^## ${packageJson.version.replaceAll('.', '\\.')}\\b`, 'm'));

for (const version of ['22', '24', '26']) {
  assert.ok(ci.includes(version), `CI omits supported Node ${version}`);
}
assert.match(ci, /mathjs-version:[\s\S]*15\.2\.0/);
assert.match(publish, /push:[\s\S]*tags:[\s\S]*["']v\*["']/);
assert.match(
  publish,
  /workflow_run:[\s\S]*workflows:\s*\[CI\][\s\S]*types:\s*\[completed\][\s\S]*branches:\s*\[main\]/
);
assert.match(publish, /workflow_dispatch:/);
assert.match(
  publish,
  /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/
);
assert.match(publish, /workflow_run\.conclusion == 'success'/);
assert.match(publish, /workflow_run\.event == 'push'/);
assert.match(publish, /workflow_run\.head_branch == 'main'/);
assert.match(publish, /workflow_run\.head_repository\.full_name == github\.repository/);
assert.match(
  publish,
  /ref:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha \|\| github\.sha\s*\}\}/
);
assert.match(publish, /contents:\s*write/);
assert.match(publish, /id-token:\s*write/);
assert.match(publish, /cancel-in-progress:\s*false/);
assert.match(publish, /git fetch --no-tags origin main/);
assert.match(publish, /npm run test:release/);
assert.match(publish, /npm run check/);
assert.match(
  publish,
  /npm view "\$\{PACKAGE_NAME\}@\$\{PACKAGE_VERSION\}" version/
);
assert.match(publish, /registry_status=\$\?/);
assert.match(publish, /grep -q 'E404'/);
assert.match(publish, /exit "\$registry_status"/);
assert.match(publish, /steps\.registry\.outputs\.published == 'false'/);
assert.match(publish, /npm publish --provenance --access public/);
assert.match(
  publish,
  /name: Ensure release tag[\s\S]*steps\.registry\.outputs\.published == 'false'[\s\S]*steps\.final-source\.outputs\.current == 'true'/
);
assert.match(publish, /git push origin "refs\/tags\/\$\{tag\}"/);

const tagName = process.env.GITHUB_REF_TYPE === 'tag'
  ? process.env.GITHUB_REF_NAME
  : process.env.GITHUB_REF?.startsWith('refs/tags/')
    ? process.env.GITHUB_REF.slice('refs/tags/'.length)
    : undefined;
if (tagName !== undefined) {
  assert.equal(
    tagName,
    `v${packageJson.version}`,
    'Release tag must exactly match package.json version'
  );
}
