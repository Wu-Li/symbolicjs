import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {all, create} from 'mathjs';
import {importsymbolicjs} from '../dist/index.js';

const math = importsymbolicjs(create(all));
const corpus = [
  ['x + 2 =:= 5', 'x'],
  ['abs(x - 2) =:= 3', 'x'],
  ['1/x + 1/(x + 1) =:= 0', 'x'],
  ['x*x - 5*x + 6 =:= 0', 'x'],
  ['x*x*x - 6*x*x + 11*x - 6 =:= 0', 'x']
];
const started = performance.now();

for (let iteration = 0; iteration < 50; iteration += 1) {
  for (const [source, target] of corpus) {
    const result = math.solveEquation(source, target);
    assert.notEqual(result.kind, 'unsupported');
  }
}

const elapsed = performance.now() - started;
assert.ok(elapsed < 10_000, 'Solver benchmark exceeded 10 seconds: ' + elapsed + 'ms');

const highDegreeStarted = performance.now();
for (const [source, degree] of [
  ['(x^19 - 1)*(x + 2) =:= 0', 20],
  ['(x^49 - 1)*(x + 2) =:= 0', 50],
  ['(x^99 - 1)*(x + 2) =:= 0', 100]
]) {
  const result = math.solveEquation(source, 'x', {
    limits: {
      numericPolynomialDegree: degree,
      candidates: degree,
      numericIterations: 1_000,
      totalWork: 200_000
    }
  });
  assert.equal(result.kind, 'finite');
}
const highDegreeElapsed = performance.now() - highDegreeStarted;
assert.ok(
  highDegreeElapsed < 5_000,
  'High-degree benchmark exceeded 5 seconds: ' + highDegreeElapsed + 'ms'
);
