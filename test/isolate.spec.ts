import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import type {FiniteSolutions, PartialResult, SolveResult} from '../src/index.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

function solutions(result: SolveResult): FiniteSolutions | PartialResult {
  expect(['finite', 'partial']).toContain(result.kind);
  return result as FiniteSolutions | PartialResult;
}

function numericValues(result: SolveResult): number[] {
  return solutions(result).solutions
    .map((solution) => Number(solution.value.compile().evaluate()))
    .sort((left, right) => left - right);
}

describe('single-occurrence arithmetic isolation', () => {
  it.each([
    ['x + 2 =:= 5', 3],
    ['2 + x =:= 5', 3],
    ['x - 2 =:= 5', 7],
    ['5 - x =:= 2', 3],
    ['2 * x =:= 8', 4],
    ['x / 2 =:= 3', 6],
    ['8 / x =:= 2', 4],
    ['-x =:= 2', -2],
    ['+x =:= 2', 2],
    ['2 =:= x + 1', 1],
    ['(x) =:= 2', 2]
  ])('solves %s', (source, expected) => {
    const math = createMath();
    const result = math.solveEquation(source, 'x');

    expect(result.kind).toBe('finite');
    expect(numericValues(result)).toEqual([expected]);
    expect(solutions(result).solutions[0]!.verification.status).toBe('proven');
  });

  it('returns a conditional partial result for symbolic division', () => {
    const math = createMath();
    const result = math.solveEquation('a*x =:= b', 'x');
    const solution = solutions(result).solutions[0]!;

    expect(result.kind).toBe('partial');
    expect(solution.value.toString()).toBe('b / a');
    expect(solution.conditions.map((condition) => condition.kind + ':' + condition.expression))
      .toContain('nonzero:a');
    expect(solution.verification.status).toBe('inconclusive');
  });

  it('classifies constant identities and contradictions after simplification', () => {
    const math = createMath();

    expect(math.solveEquation('0*x =:= 0', 'x').kind).toBe('identity');
    expect(math.solveEquation('0*x =:= 1', 'x').kind).toBe('contradiction');
  });
});

describe('powers and inverse functions', () => {
  it('returns both roots of a positive even power', () => {
    const math = createMath();

    expect(numericValues(math.solveEquation('x^2 =:= 9', 'x'))).toEqual([-3, 3]);
  });

  it.each([
    ['x^3 =:= 8', 2],
    ['x^0.5 =:= 3', 9],
    ['sqrt(x + 1) =:= 3', 8],
    ['exp(x) =:= 1', 0],
    ['log(x) =:= 2', Math.exp(2)],
    ['log10(x) =:= 2', 100],
    ['log(x, 2) =:= 3', 8],
    ['2^x =:= 8', 3]
  ])('solves %s', (source, expected) => {
    const math = createMath();
    const [actual] = numericValues(math.solveEquation(source, 'x'));

    expect(actual).toBeCloseTo(expected, 10);
  });

  it('handles negative integer powers', () => {
    const math = createMath();

    expect(numericValues(math.solveEquation('x^(-2) =:= 1', 'x')))
      .toEqual([-1, 1]);
  });

  it('preserves symbolic logarithm-base restrictions', () => {
    const math = createMath();
    const result = solutions(math.solveEquation('log(x, b) =:= y', 'x'));
    const conditions = result.solutions[0]!.conditions
      .map((condition) => condition.kind + ':' + condition.expression.toString());

    expect(result.solutions[0]!.value.toString()).toBe('b ^ y');
    expect(conditions).toContain('positive:b');
    expect(conditions).toContain('nonzero:b - 1');
  });

  it('branches absolute value solutions', () => {
    const math = createMath();

    expect(numericValues(math.solveEquation('abs(x - 2) =:= 3', 'x')))
      .toEqual([-1, 5]);
  });

  it('rejects extraneous real-domain candidates', () => {
    const math = createMath();

    expect(math.solveEquation('sqrt(x) =:= -1', 'x').kind)
      .toBe('contradiction');
    expect(math.solveEquation('abs(x) =:= -1', 'x').kind)
      .toBe('contradiction');
  });

  it.each([
    'sin(x) =:= 0',
    'x^a =:= b',
    'x mod 2 =:= 0',
    'f(x, y) =:= 1'
  ])('returns unsupported for %s', (source) => {
    const math = createMath();

    expect(math.solveEquation(source, 'x').kind).toBe('unsupported');
  });

  it('classifies a zero power simplified by MathJS', () => {
    const math = createMath();

    expect(math.solveEquation('x^0 =:= 1', 'x').kind).toBe('identity');
  });
});

describe('isolation limits and result stability', () => {
  it.each([
    [{rewriteSteps: 0}, 'rewrite-steps'],
    [{recursionDepth: 0}, 'recursion-depth'],
    [{branches: 0}, 'branches'],
    [{candidates: 0}, 'candidates'],
    [{totalWork: 0}, 'total-work']
  ] as const)('enforces %s', (limits, expected) => {
    const math = createMath();
    const source = expected === 'branches' ? 'x^2 =:= 4' : 'x + 1 =:= 2';

    expect(math.solveEquation(source, 'x', {limits})).toEqual({
      kind: 'limit',
      target: 'x',
      limit: expected
    });
  });

  it('deduplicates a repeated zero root and freezes results', () => {
    const math = createMath();
    const result = math.solveEquation('x^2 =:= 0', 'x');
    const finite = solutions(result);

    expect(finite.solutions).toHaveLength(1);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(finite.solutions)).toBe(true);
    expect(Object.isFrozen(finite.solutions[0])).toBe(true);
  });
});
