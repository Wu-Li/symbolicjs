import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import type {FiniteSolutions, PartialResult, SolveResult} from '../src/index.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

function solved(result: SolveResult): FiniteSolutions | PartialResult {
  expect(['finite', 'partial']).toContain(result.kind);
  return result as FiniteSolutions | PartialResult;
}

function values(
  result: SolveResult,
  scope: Record<string, number> = {}
): number[] {
  return solved(result).solutions.map((solution) =>
    Number(solution.value.compile().evaluate(scope))
  ).sort((left, right) => left - right);
}

describe('numeric quadratic solving', () => {
  it.each([
    ['x*x - 5*x + 6 =:= 0', [2, 3]],
    ['2*x*x + 3*x - 2 =:= 0', [-2, 0.5]],
    ['x*x =:= 4*x', [0, 4]]
  ])('solves %s', (source, expected) => {
    const math = createMath();
    const result = math.solveEquation(source, 'x');

    expect(result.kind).toBe('finite');
    expect(values(result)).toEqual(expected);
    expect(solved(result).solutions.every(
      (solution) => solution.verification.status === 'proven'
    )).toBe(true);
  });

  it('deduplicates a zero-discriminant root', () => {
    const math = createMath();
    const result = math.solveEquation('x*x + 2*x + 1 =:= 0', 'x');

    expect(values(result)).toEqual([-1]);
  });

  it('returns a contradiction for a negative real discriminant', () => {
    const math = createMath();

    expect(math.solveEquation('x*x + 1 =:= 0', 'x').kind)
      .toBe('contradiction');
  });

  it('preserves exact irrational expressions', () => {
    const math = createMath();
    const result = solved(math.solveEquation('x*x - 2 =:= 0', 'x'));

    expect(result.solutions).toHaveLength(2);
    expect(result.solutions.every((solution) => solution.exact)).toBe(true);
    expect(values(result)[0]).toBeCloseTo(-Math.sqrt(2), 12);
    expect(values(result)[1]).toBeCloseTo(Math.sqrt(2), 12);
  });
});

describe('symbolic and rational quadratics', () => {
  it('returns discriminant and leading-coefficient conditions', () => {
    const math = createMath();
    const result = solved(math.solveEquation('a*x*x + b*x + c =:= 0', 'x'));
    const conditions = result.solutions[0]!.conditions.map((condition) =>
      condition.kind + ':' + condition.expression.toString()
    );

    expect(result.kind).toBe('partial');
    expect(result.solutions).toHaveLength(2);
    expect(conditions).toContain('nonzero:a');
    expect(conditions.some((condition) => condition.startsWith('nonnegative:')))
      .toBe(true);
    expect(values(result, {a: 1, b: -5, c: 6})).toEqual([2, 3]);
  });

  it('handles a symbolic middle coefficient', () => {
    const math = createMath();
    const result = math.solveEquation('x*x + a*x =:= 0', 'x');

    expect(result.kind).toBe('partial');
    expect(values(result, {a: 4})).toEqual([-4, 0]);
  });

  it('rejects a quadratic root excluded by a denominator', () => {
    const math = createMath();
    const result = math.solveEquation('(x*x - 1)/(x - 1) =:= 0', 'x');

    expect(values(result)).toEqual([-1]);
  });

  it('degenerates to the affine solver when MathJS removes a zero term', () => {
    const math = createMath();
    const result = math.solveEquation('0*x*x + 2*x =:= 4', 'x');

    expect(values(result)).toEqual([2]);
  });
});

describe('quadratic budgets', () => {
  it('enforces branch and candidate limits', () => {
    const math = createMath();

    expect(math.solveEquation('x*x - 1 =:= 0', 'x', {
      limits: {branches: 1}
    })).toEqual({kind: 'limit', target: 'x', limit: 'branches'});
    expect(math.solveEquation('x*x - 1 =:= 0', 'x', {
      limits: {candidates: 0}
    })).toEqual({kind: 'limit', target: 'x', limit: 'candidates'});
  });
});
