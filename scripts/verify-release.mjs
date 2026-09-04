import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));
const ci = read('.github/workflows/ci.yml');
const publish = read('.github/workflows/publish.yml');

assert.match(packageJson.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
assert.equal(packageLock.version, packageJson.version);
assert.equal(packageLock.packages[''].version, packageJson.version);

for (const version of ['22', '24', '26']) {
  assert.ok(ci.includes(version), `Full verification omits supported Node ${version}`);
}
assert.match(ci, /mathjs-version:[\s\S]*15\.2\.0/);
assert.match(ci, /^\s{2}workflow_call:\s*$/m);
assert.match(ci, /^\s{2}workflow_dispatch:\s*$/m);
assert.doesNotMatch(ci, /^\s{2}push:/m);
assert.doesNotMatch(ci, /^\s{2}pull_request:/m);
assert.match(ci, /npm run check/);

assert.match(publish, /push:[\s\S]*branches:\s*\[main\]/);
assert.match(publish, /workflow_dispatch:/);
assert.doesNotMatch(publish, /^\s+tags:/m);
assert.doesNotMatch(publish, /workflow_run:/);
assert.match(publish, /github\.ref == 'refs\/heads\/main'/);
assert.match(publish, /contents:\s*read/);
assert.match(publish, /id-token:\s*write/);
assert.match(publish, /group:\s*npm-publish-main/);
assert.match(publish, /cancel-in-progress:\s*true/);
assert.match(publish, /npm run test:release/);
assert.match(
  publish,
  /npm view "\$\{PACKAGE_NAME\}@\$\{PACKAGE_VERSION\}" version/
);
assert.match(publish, /registry_status=\$\?/);
assert.match(publish, /grep -q 'E404'/);
assert.match(publish, /exit "\$registry_status"/);
assert.match(publish, /uses:\s*\.\/\.github\/workflows\/ci\.yml/);
assert.match(publish, /needs\.release\.outputs\.published == 'false'/);
assert.match(publish, /needs\.verify\.result == 'success'/);
assert.doesNotMatch(publish, /npm run check/);
assert.match(publish, /npm run build/);
assert.match(publish, /npm publish --provenance --access public/);
assert.doesNotMatch(publish, /Ensure release tag/);
assert.doesNotMatch(publish, /git (?:tag|push)/);
