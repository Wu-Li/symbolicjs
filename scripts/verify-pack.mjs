import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const root = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'symbolicjs-pack-'));

try {
  const pack = JSON.parse(execFileSync(
    'npm',
    ['pack', '--json', '--pack-destination', temporary],
    {cwd: root, encoding: 'utf8'}
  ));
  const tarball = join(temporary, pack[0].filename);
  const consumer = join(temporary, 'consumer');

  execFileSync('mkdir', ['-p', consumer]);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({
    private: true,
    type: 'module'
  }));
  execFileSync(
    'npm',
    ['install', '--ignore-scripts', '--no-package-lock', tarball, 'mathjs@15.2.0'],
    {cwd: consumer, stdio: 'pipe'}
  );

  const packageJson = JSON.parse(readFileSync(
    join(consumer, 'node_modules/symbolicjs/package.json'),
    'utf8'
  ));
  assert.deepEqual(packageJson.files, ['dist']);

  const {all, create} = await import(
    pathToFileURL(join(consumer, 'node_modules/mathjs/lib/esm/index.js')).href
  );
  const {importsymbolicjs} = await import(
    pathToFileURL(join(consumer, 'node_modules/symbolicjs/dist/index.js')).href
  );
  const math = importsymbolicjs(create(all));
  const equation = math.parseEquation('x + 1 =:= 3');

  assert.equal(equation.type, 'EqualityNode');
  assert.equal(equation.toString(), 'x + 1 =:= 3');
  assert.equal(equation.compile().evaluate({x: 2}), true);
} finally {
  rmSync(temporary, {recursive: true, force: true});
}
