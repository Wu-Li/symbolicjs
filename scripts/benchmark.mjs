import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {all, create} from 'mathjs';
import {importsymbolicjs} from '../dist/index.js';

const math = importsymbolicjs(create(all));
const measurements = [];

function measure(label, iterations, maximumMilliseconds, operation) {
  const started = performance.now();
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    operation();
  }
  const elapsed = performance.now() - started;
  measurements.push({label, iterations, elapsedMilliseconds: Math.round(elapsed)});
  assert.ok(
    elapsed < maximumMilliseconds,
    `${label} benchmark exceeded ${maximumMilliseconds}ms: ${elapsed}ms`
  );
}

const elementaryCorpus = [
  ['x + 2 =:= 5', 'x'],
  ['abs(x - 2) =:= 3', 'x'],
  ['1/x + 1/(x + 1) =:= 0', 'x'],
  ['x*x - 5*x + 6 =:= 0', 'x'],
  ['x*x*x - 6*x*x + 11*x - 6 =:= 0', 'x']
];

measure('elementary-corpus', 50, 10_000, () => {
  for (const [source, target] of elementaryCorpus) {
    assert.notEqual(math.solveEquation(source, target).kind, 'unsupported');
  }
});

measure('isolated-trigonometric', 100, 5_000, () => {
  assert.equal(math.solveEquation('sin(3*x - 1) =:= 1/2', 'x').kind, 'parametric');
});

measure('quartic-construction', 50, 5_000, () => {
  assert.equal(math.solveEquation('x^4 - 5*x^2 + 4 =:= 0', 'x').kind, 'finite');
});

for (const [source, degree] of [
  ['(x^19 - 1)*(x + 2) =:= 0', 20],
  ['(x^49 - 1)*(x + 2) =:= 0', 50],
  ['(x^99 - 1)*(x + 2) =:= 0', 100]
]) {
  measure(`numeric-polynomial-degree-${degree}`, 1, 5_000, () => {
    const result = math.solveEquation(source, 'x', {
      limits: {
        numericPolynomialDegree: degree,
        candidates: degree,
        numericIterations: 1_000,
        totalWork: 500_000
      }
    });
    assert.equal(result.kind, 'finite');
  });
}

measure('bounded-numeric-search', 10, 5_000, () => {
  const result = math.solveEquation('sin(x) =:= x/2', 'x', {
    numericFallback: true,
    interval: {lower: -2, upper: 2}
  });
  assert.equal(result.kind, 'partial');
  assert.equal(result.solutions.length, 3);
});

console.log(JSON.stringify({benchmarks: measurements}));
