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
  const packedPaths = pack[0].files.map((entry) => entry.path);

  for (const required of [
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
    'dist/index.js',
    'dist/index.d.ts',
    'docs/algorithms.md',
    'docs/api.md',
    'docs/architecture-migration/README.md',
    'docs/architecture-migration/baseline-metrics.json',
    'docs/architecture-migration/chapter-1.md',
    'docs/architecture-migration/chapter-2.md',
    'docs/architecture-migration/chapter-3.md',
    'docs/architecture-migration/mathjs-api-boundary.md',
    'docs/architecture-migration/module-map.json',
    'docs/architecture-migration/public-api.json',
    'docs/conformance.md',
    'docs/performance.md',
    'docs/security.md',
    'docs/testing.md'
  ]) {
    assert.ok(packedPaths.includes(required), `Packed artifact omitted ${required}`);
  }
  assert.equal(packedPaths.some((path) => /^(src|test|scripts|\.github)\//.test(path)), false);

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
  assert.deepEqual(packageJson.files, ['CHANGELOG.md', 'dist', 'docs']);
  assert.deepEqual(packageJson.dependencies ?? {}, {});
  assert.equal(packageJson.peerDependencies.mathjs, '>=15.2.0 <16');

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
  const symbolicNode = math.symbolic.nodes.symbol('x');
  assert.equal(symbolicNode.type, 'SymbolNode');
  const operation = math.symbolic.operation({limits: {steps: 1}});
  assert.equal(operation.consume('steps'), null);
  assert.deepEqual(operation.consume('steps'), {
    kind: 'limit', limit: 'steps', used: 2, maximum: 1
  });
  const predicate = math.symbolic.predicates.positive(symbolicNode);
  assert.equal(math.symbolic.ask(predicate).truth, 'unknown');
  assert.equal(
    math.symbolic.require(predicate, {mode: 'conditional'}).kind,
    'conditional'
  );
  const structure = math.symbolic.structure.analyze(
    math.parse('x + 1'),
    {target: 'x'}
  );
  assert.equal(structure.cost.metrics.targetOccurrences, 1);
  assert.match(structure.fingerprint, /^s1-[0-9a-f]{16}$/);
  const solved = math.solveEquation('x*x - 1 =:= 0', 'x');
  assert.equal(solved.kind, 'finite');
  assert.equal(solved.solutions.length, 2);
  const periodic = math.solveEquation('sin(x) =:= 0', 'x');
  assert.equal(periodic.kind, 'parametric');
  assert.equal(periodic.families.length, 1);
  const bounded = math.solveEquation('sin(x) =:= x/2', 'x', {
    numericFallback: true,
    interval: {lower: -2, upper: 2}
  });
  assert.equal(bounded.kind, 'partial');
  assert.equal(bounded.solutions.length, 3);
  const complex = math.solveEquation('x^2 + 1 =:= 0', 'x', {domain: 'complex'});
  assert.equal(complex.kind, 'finite');
  assert.equal(complex.solutions.length, 2);
  assert.deepEqual(
    complex.solutions.map((solution) => {
      const value = solution.value.compile().evaluate();
      return [value.re, value.im];
    }),
    [[0, -1], [0, 1]]
  );
  const restored = JSON.parse(JSON.stringify(equation), math.reviver);
  assert.equal(restored.isEqualityNode, true);
  assert.equal(math.solveEquation(restored, 'x').kind, 'finite');
  assert.deepEqual([...math.solveEquationForAll('x + y =:= 1').keys()], ['x', 'y']);
} finally {
  rmSync(temporary, {recursive: true, force: true});
}
