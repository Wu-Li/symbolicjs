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
