import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {all, create} from 'mathjs';
import {importsymbolicjs} from '../dist/index.js';

const root = resolve(import.meta.dirname, '..');
const math = importsymbolicjs(create(all));
math.import({
  tauConstant: 2 * Math.PI,
  triple: (value) => value * 3
});

function countNodes(node) {
  let count = 0;
  node.traverse(() => { count += 1; });
  return count;
}

function measure(label, iterations, operation) {
  for (let index = 0; index < Math.min(5, iterations); index += 1) {
    operation();
  }
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    operation();
  }
  const elapsedMilliseconds = performance.now() - started;
  return {
    label,
    iterations,
    elapsedMilliseconds: Number(elapsedMilliseconds.toFixed(3)),
    averageMicroseconds: Number((elapsedMilliseconds * 1000 / iterations).toFixed(3))
  };
}

const conformance = JSON.parse(readFileSync(
  resolve(root, 'test/fixtures/conformance.json'),
  'utf8'
));

function solveFixture(entry) {
  const options = {};
  if (entry.domain !== undefined) options.domain = entry.domain;
  if (entry.interval !== undefined) options.interval = entry.interval;
  if (entry.numericFallback !== undefined) options.numericFallback = entry.numericFallback;
  if (entry.tolerance !== undefined) options.tolerance = entry.tolerance;
  return math.solveEquation(entry.equation, entry.target, options);
}

const timings = [
  measure('simplify-neutral-elements', 1000, () =>
    math.symbolicKernel.simplify(math.parse('(x + 0) * 1'))),
  measure('canonical-key-polynomial', 500, () =>
    math.symbolicKernel.canonicalKey(math.parse('(x + 0)^2 + 2*x + 1'))),
  measure('conformance-corpus', 3, () => {
    for (const entry of conformance) solveFixture(entry);
  }),
  measure('symbolic-cubic', 10, () =>
    math.solveEquation('x^3 - 3*x + a =:= 0', 'x')),
  measure('symbolic-biquadratic', 10, () =>
    math.solveEquation('x^4 + a*x^2 + 1 =:= 0', 'x'))
];

const expressionMetrics = [];
for (const [label, source] of [
  ['symbolic-cubic', 'x^3 - 3*x + a =:= 0'],
  ['symbolic-biquadratic', 'x^4 + a*x^2 + 1 =:= 0']
]) {
  const result = math.solveEquation(source, 'x');
  const expressions = result.kind === 'finite' || result.kind === 'partial'
    ? result.solutions.map((solution) => solution.value)
    : result.kind === 'parametric'
      ? result.families.map((family) => family.value)
      : [];
  const counts = expressions.map(countNodes);
  expressionMetrics.push({
    label,
    resultKind: result.kind,
    expressionCount: expressions.length,
    totalNodes: counts.reduce((sum, count) => sum + count, 0),
    peakNodes: Math.max(0, ...counts)
  });
}

function walk(directory) {
  return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const dist = resolve(root, 'dist');
const productionJavaScriptBytes = Object.fromEntries(
  walk(dist)
    .filter((path) => path.endsWith('.js'))
    .map((path) => [relative(dist, path), statSync(path).size])
    .sort(([left], [right]) => left.localeCompare(right))
);

const pack = JSON.parse(execFileSync(
  'npm',
  ['pack', '--json', '--dry-run'],
  {cwd: root, encoding: 'utf8'}
))[0];

const baseline = {
  schemaVersion: 1,
  sourceCommit: process.env.SYMBOLICJS_BASELINE_COMMIT ?? 'working-tree',
  packageVersion: JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version,
  runtime: {node: process.version, mathjs: math.version},
  package: {
    packedBytes: pack.size,
    unpackedBytes: pack.unpackedSize,
    fileCount: pack.entryCount
  },
  productionJavaScriptBytes,
  timings,
  expressionMetrics
};

const output = JSON.stringify(baseline, null, 2) + '\n';
const outputPath = process.argv[2];
if (outputPath) {
  writeFileSync(resolve(process.cwd(), outputPath), output);
} else {
  process.stdout.write(output);
}
