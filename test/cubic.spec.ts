import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import {approximateConditionViolated} from '../src/polynomial.js';
import type {ConditionKind} from '../src/index.js';
import type {FiniteSolutions, SolveResult} from '../src/index.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

function values(result: SolveResult): number[] {
  expect(result.kind).toBe('finite');
  return (result as FiniteSolutions).solutions.map((solution) =>
    Number(solution.value.compile().evaluate())
  ).sort((left, right) => left - right);
}

function expectRoots(actual: number[], expected: number[], precision = 10): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => {
    expect(actual[index]).toBeCloseTo(value, precision);
  });
}

describe('numeric cubic fallback', () => {
  it('solves 3 distinct real roots', () => {
    const math = createMath();
    const result = math.solveEquation(
      'x*x*x - 6*x*x + 11*x - 6 =:= 0',
      'x'
    );

    expectRoots(values(result), [1, 2, 3]);
    expect((result as FiniteSolutions).solutions.every(
      (solution) => !solution.exact && solution.verification.status === 'proven'
    )).toBe(true);
  });

  it('solves a cubic with 1 real root', () => {
    const math = createMath();

    expectRoots(
      values(math.solveEquation('x*x*x + x + 1 =:= 0', 'x')),
      [-0.6823278038280193]
    );
  });

  it('deduplicates double and triple roots', () => {
    const math = createMath();

    expectRoots(
      values(math.solveEquation('x*x*x - 3*x + 2 =:= 0', 'x')),
      [-2, 1]
    );
    expectRoots(values(math.solveEquation('x*x*x =:= 0', 'x')), [0]);
  });

  it('keeps close distinct roots and handles coefficient scale', () => {
    const math = createMath();
    const close = math.solveEquation(
      '(x - 1)*(x - 1.0001)*(x + 2) =:= 0',
      'x'
    );
    const scaled = math.solveEquation(
      '0.000001*(x - 1)*(x - 2)*(x - 3) =:= 0',
      'x'
    );

    expectRoots(values(close), [-2, 1, 1.0001], 6);
    expectRoots(values(scaled), [1, 2, 3], 8);
  });

  it('rejects a cubic root excluded by a denominator', () => {
    const math = createMath();
    const result = math.solveEquation(
      '(x*x*x - 6*x*x + 11*x - 6)/(x - 1) =:= 0',
      'x'
    );

    expectRoots(values(result), [2, 3]);
  });

  it('retains a target-free symbolic denominator condition', () => {
    const math = createMath();
    const result = math.solveEquation(
      '(x*x*x - 6*x*x + 11*x - 6)/a =:= 0',
      'x'
    );

    expectRoots(values(result), [1, 2, 3]);
    expect((result as FiniteSolutions).solutions.every((solution) =>
      solution.conditions.some((condition) =>
        condition.kind === 'nonzero' && condition.expression.toString() === 'a'
      )
    )).toBe(true);
  });

  it('dispatches symbolic cubic coefficients to the exact solver', () => {
    const math = createMath();
    const result = math.solveEquation('a*x*x*x + x =:= 0', 'x');

    expect(result.kind).toBe('partial');
    expect(result.kind === 'partial' && result.solutions.every(
      (solution) => solution.certificate?.kind === 'cubic'
    )).toBe(true);
  });
});

describe('numeric cubic limits', () => {
  const source = 'x*x*x - 6*x*x + 11*x - 6 =:= 0';

  it.each([
    [{numericIterations: 0}, 'numeric-iterations'],
    [{branches: 1}, 'branches'],
    [{candidates: 0}, 'candidates'],
    [{polynomialDegree: 2}, 'polynomial-degree']
  ] as const)('enforces %s', (limits, expected) => {
    const math = createMath();

    expect(math.solveEquation(source, 'x', {limits})).toEqual({
      kind: 'limit',
      target: 'x',
      limit: expected
    });
  });

  it('rejects invalid numeric tolerance', () => {
    const math = createMath();

    expect(() => math.solveEquation(source, 'x', {tolerance: 0}))
      .toThrow(RangeError);
  });
});

describe('approximate domain boundaries', () => {
  it.each<[ConditionKind, number, boolean]>([
    ['zero', 1, true],
    ['zero', 0, false],
    ['nonzero', 0, true],
    ['nonzero', 1, false],
    ['positive', 0, true],
    ['positive', 1, false],
    ['nonnegative', -1, true],
    ['nonnegative', 0, false],
    ['negative', 0, true],
    ['negative', -1, false],
    ['nonpositive', 1, true],
    ['nonpositive', 0, false],
    ['defined', 0, false]
  ])('checks %s at %s', (kind, value, expected) => {
    expect(approximateConditionViolated(kind, value, 1e-12)).toBe(expected);
  });
});

describe('remaining supported and unsupported function families', () => {
  it.each([
    ['x^(1/3) =:= 2', 8],
    ['x^(1/4) =:= 2', 16]
  ])('isolates reciprocal integer power %s', (source, expected) => {
    const math = createMath();

    expectRoots(values(math.solveEquation(source, 'x')), [expected]);
  });

  it.each([
    'sin(x) + x =:= 0',
    'cos(x) =:= x',
    'exp(x) + x =:= 1',
    'x^x =:= 2'
  ])('returns promptly for unsupported family %s', (source) => {
    const math = createMath();

    expect(math.solveEquation(source, 'x').kind).toBe('unsupported');
  });
});
