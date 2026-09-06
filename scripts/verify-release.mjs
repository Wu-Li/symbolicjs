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

assert.match(ci, /node-version:\s*26/);
assert.doesNotMatch(ci, /node-version:\s*(?:22|24)/);
assert.match(ci, /mathjs@\^15\.2\.0/);
assert.match(ci, /^\s{2}push:\s*$/m);
assert.match(ci, /^\s{2}workflow_call:\s*$/m);
assert.match(ci, /^\s{2}workflow_dispatch:\s*$/m);
assert.match(ci, /npm run check/);

assert.match(publish, /release:[\s\S]*types:\s*\[published\]/);
assert.match(publish, /workflow_dispatch:/);
assert.doesNotMatch(publish, /^\s{2}push:/m);
assert.match(publish, /github\.event\.release\.tag_name/);
assert.match(publish, /Validate release tag matches package version/);
assert.match(publish, /contents:\s*read/);
assert.match(publish, /id-token:\s*write/);
assert.match(publish, /group:\s*npm-publish-release/);
assert.match(publish, /cancel-in-progress:\s*false/);
assert.match(publish, /node-version:\s*26/);
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
assert.doesNotMatch(publish, /git (?:tag|push)/);
