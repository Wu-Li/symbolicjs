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
assert.match(publish, /tags:[\s\S]*["']v\*["']/);
assert.match(publish, /id-token:\s*write/);
assert.match(publish, /npm run check/);
assert.match(publish, /npm publish --provenance --access public/);

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
