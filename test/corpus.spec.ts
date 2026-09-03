import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';

const cases = [
  ['1 =:= 1', 'x', 'unsupported'],
  ['x + 1 =:= 2', 'x', 'finite'],
  ['0*x =:= 0', 'x', 'identity'],
  ['0*x =:= 1', 'x', 'contradiction'],
  ['a*x =:= b', 'x', 'partial'],
  ['sqrt(x) =:= -1', 'x', 'contradiction'],
  ['abs(x) =:= 2', 'x', 'finite'],
  ['x + x =:= 2', 'x', 'finite'],
  ['x/x =:= 1', 'x', 'identity'],
  ['x/(x - 1) =:= 1', 'x', 'contradiction'],
  ['x*x - 1 =:= 0', 'x', 'finite'],
  ['x*x + 1 =:= 0', 'x', 'contradiction'],
  ['a*x*x + b*x + c =:= 0', 'x', 'partial'],
  ['x*x*x - x =:= 0', 'x', 'finite'],
  ['a*x*x*x - x =:= 0', 'x', 'unsupported'],
  ['sin(x) + x =:= 0', 'x', 'unsupported']
] as const;

describe('permanent regression corpus', () => {
  it.each(cases)('%s for %s is %s', (source, target, expected) => {
    const math = importsymbolicjs(create(all!));
    const result = math.solveEquation(source, target);

    expect(result.kind).toBe(expected);
    if (result.kind === 'finite') {
      for (const solution of result.solutions) {
        expect(solution.verification.status).toBe('proven');
      }
    }
  });
});
