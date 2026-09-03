import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs, PolynomialEngine} from '../src/index.js';
import type {FiniteSolutions, PartialResult, SolveResult} from '../src/index.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

function solutions(result: SolveResult): FiniteSolutions | PartialResult {
  expect(['finite', 'partial']).toContain(result.kind);
  return result as FiniteSolutions | PartialResult;
}

function evaluateSolution(
  result: SolveResult,
  scope: Record<string, number> = {}
): number {
  return Number(solutions(result).solutions[0]!.value.compile().evaluate(scope));
}

describe('affine polynomial solving', () => {
  it.each([
    ['x + x =:= 6', 3],
    ['-(x + x) =:= -4', 2],
    ['2*x + 3*x =:= 10', 2],
    ['3*(x + 2) =:= 12', 2],
    ['10 =:= 2*x + x + 1', 3]
  ])('solves repeated-target equation %s', (source, expected) => {
    const math = createMath();
    const result = math.solveEquation(source, 'x');

    expect(result.kind).toBe('finite');
    expect(evaluateSolution(result)).toBeCloseTo(expected, 12);
  });

  it('returns a conditional result for symbolic coefficients', () => {
    const math = createMath();
    const result = math.solveEquation('a*x + b*x =:= c', 'x');
    const solved = solutions(result);

    expect(result.kind).toBe('partial');
    expect(evaluateSolution(result, {a: 2, b: 3, c: 10})).toBe(2);
    expect(solved.solutions[0]!.conditions.some((condition) =>
      condition.kind === 'nonzero' && condition.expression.toString().includes('a + b')
    )).toBe(true);
  });

  it('classifies affine identities and contradictions', () => {
    const math = createMath();

    expect(math.solveEquation('x + x =:= 2*x', 'x').kind).toBe('identity');
    expect(math.solveEquation('x + x =:= 2*x + 1', 'x').kind)
      .toBe('contradiction');
  });
});

describe('rational normalization', () => {
  it.each([
    ['x/(x - 1) =:= 2', 2],
    ['1/x + 1/(x + 1) =:= 0', -0.5]
  ])('solves %s while retaining denominator exclusions', (source, expected) => {
    const math = createMath();
    const result = math.solveEquation(source, 'x');

    expect(evaluateSolution(result)).toBeCloseTo(expected, 12);
    expect(solutions(result).solutions[0]!.conditions.some(
      (condition) => condition.kind === 'nonzero'
    )).toBe(true);
  });

  it('rejects roots excluded by an original denominator', () => {
    const math = createMath();

    expect(math.solveEquation('x/(x - 1) =:= 1', 'x').kind)
      .toBe('contradiction');
  });

  it('retains the domain of a rational identity', () => {
    const math = createMath();
    const result = math.solveEquation('x/x =:= 1', 'x');

    expect(result.kind).toBe('identity');
    if (result.kind === 'identity') {
      expect(result.conditions.map((condition) =>
        condition.kind + ':' + condition.expression.toString()
      )).toContain('nonzero:x');
    }
  });

  it('classifies unequal rational expressions as contradictions', () => {
    const math = createMath();

    expect(math.solveEquation('1/(x - 1) =:= 1/(x + 1)', 'x').kind)
      .toBe('contradiction');
  });
});

describe('polynomial boundaries and limits', () => {
  it.each([
    'x^2 + x =:= 1',
    'sin(x) + x =:= 0',
    'x^a + x =:= 0',
    'x^1.5 + x =:= 0',
    'x mod 2 + x =:= 0'
  ])('defers unsupported form %s', (source) => {
    const math = createMath();

    expect(math.solveEquation(source, 'x').kind).toBe('unsupported');
  });

  it('enforces polynomial degree, rewrite, and total-work limits', () => {
    const math = createMath();

    expect(math.solveEquation('x*x + x =:= 0', 'x', {
      limits: {polynomialDegree: 1}
    })).toEqual({kind: 'limit', target: 'x', limit: 'polynomial-degree'});
    expect(math.solveEquation('x + x =:= 2', 'x', {
      limits: {rewriteSteps: 0}
    })).toEqual({kind: 'limit', target: 'x', limit: 'rewrite-steps'});
    expect(math.solveEquation('x + x =:= 2', 'x', {
      limits: {totalWork: 0}
    })).toEqual({kind: 'limit', target: 'x', limit: 'total-work'});
  });

  it('exposes a deterministic sparse-polynomial diagnostic', () => {
    const math = createMath();
    const engine = new PolynomialEngine({
      ConstantNode: math.ConstantNode,
      OperatorNode: math.OperatorNode,
      SymbolNode: math.SymbolNode,
      symbolicKernel: math.symbolicKernel
    });

    expect(engine.debugPolynomial(math.parse('2*x + 3'), 'x'))
      .toContain('x');
    expect(engine.debugPolynomial(math.parse('sin(x)'), 'x')).toBeNull();
  });
});
