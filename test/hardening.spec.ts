import {all, create} from 'mathjs';
import fc from 'fast-check';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import type {SolveResult} from '../src/index.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

describe('adversarial complexity containment', () => {
  it('rejects a deeply constructed tree at the input-node boundary', () => {
    const math = createMath();
    let expression = math.parse('x');
    for (let index = 0; index < 200; index += 1) {
      expression = new math.OperatorNode('+', 'add', [
        expression,
        new math.ConstantNode(0)
      ]);
    }
    const equation = new math.EqualityNode(expression, new math.ConstantNode(0));

    expect(math.solveEquation(equation, 'x', {limits: {inputNodes: 64}}))
      .toEqual({kind: 'limit', target: 'x', limit: 'input-nodes'});
  });

  it('contains branch growth from nested absolute values', () => {
    expect(createMath().solveEquation('abs(abs(abs(x))) =:= 1', 'x', {
      limits: {branches: 1}
    })).toEqual({kind: 'limit', target: 'x', limit: 'branches'});
  });

  it('bounds huge parametric materialization before enumeration', () => {
    const math = createMath();
    const families = math.solveEquation('sin(x) =:= 0', 'x');
    expect(families.kind).toBe('parametric');
    if (families.kind === 'parametric') {
      expect(math.materializeSolutions(families, {
        lower: -1e15,
        upper: 1e15
      })).toEqual({kind: 'limit', target: 'x', limit: 'candidates'});
    }
  });

  it('bounds high-degree and discontinuity-heavy workloads', () => {
    const math = createMath();

    expect(math.solveEquation('x^101 - 1 =:= 0', 'x', {domain: 'complex'}))
      .toEqual({kind: 'limit', target: 'x', limit: 'numeric-polynomial-degree'});
    expect(math.solveEquation('tan(20*x) + x =:= 0', 'x', {
      numericFallback: true,
      interval: {lower: -10, upper: 10},
      limits: {functionEvaluations: 50}
    })).toEqual({kind: 'limit', target: 'x', limit: 'function-evaluations'});
    expect(math.solveEquation('1/sin(x) + x =:= 0', 'x', {
      numericFallback: true,
      interval: {lower: -20, upper: 20},
      limits: {intervalSubdivisions: 50}
    })).toEqual({kind: 'limit', target: 'x', limit: 'interval-subdivisions'});
  });
});

describe('mutation-sensitive mathematical guards', () => {
  it('rejects a perturbed candidate that is not a root', () => {
    const math = createMath();
    const equation = math.parseEquation('x^2 - 1 =:= 0');

    expect(math.symbolicKernel.verify(equation, 'x', math.parse('1')).status)
      .toBe('proven');
    expect(math.symbolicKernel.verify(equation, 'x', math.parse('1.01')).status)
      .toBe('rejected');
  });

  it('enforces inverse-function range conditions', () => {
    const math = createMath();

    expect(math.solveEquation('sin(x) =:= 1', 'x').kind).toBe('parametric');
    expect(math.solveEquation('sin(x) =:= 1.0001', 'x').kind)
      .toBe('contradiction');
    expect(math.solveEquation('acos(x) =:= -0.01', 'x').kind)
      .toBe('contradiction');
  });

  it('does not turn discontinuities into candidates or completeness claims', () => {
    const result = createMath().solveEquation('1/sin(x) =:= 0', 'x', {
      numericFallback: true,
      interval: {lower: -10, upper: 10}
    });

    expect(result.kind).toBe('partial');
    if (result.kind === 'partial') {
      expect(result.solutions).toEqual([]);
      expect(result.scope?.completeness).toBe('partial');
      expect(result.reason).toBe('numeric-search-incomplete');
    }
  });

  it('represents every public result classification', () => {
    const math = createMath();
    const results: SolveResult[] = [
      math.solveEquation('x =:= 1', 'x'),
      math.solveEquation('sin(x) =:= 0', 'x'),
      math.solveEquation('x =:= x', 'x'),
      math.solveEquation('x =:= x + 1', 'x'),
      math.solveEquation('a*x =:= b', 'x'),
      math.solveEquation('sin(x) + cos(2*x) =:= 0', 'x'),
      math.solveEquation('x + 1 =:= 2', 'x', {limits: {inputNodes: 0}})
    ];

    expect([...new Set(results.map((result) => result.kind))].sort()).toEqual([
      'contradiction',
      'finite',
      'identity',
      'limit',
      'parametric',
      'partial',
      'unsupported'
    ]);
  });
});

describe('seeded parsing and numeric validation properties', () => {
  it('round-trips generated affine equations without changing solutions', () => {
    const math = createMath();
    fc.assert(fc.property(
      fc.integer({min: -20, max: 20}).filter((value) => value !== 0),
      fc.integer({min: -100, max: 100}),
      fc.integer({min: -100, max: 100}),
      (coefficient, constant, rhs) => {
        const equation = math.parseEquation(
          `(${coefficient})*variable_θ + (${constant}) =:= ${rhs}`
        );
        const restored = JSON.parse(JSON.stringify(equation), math.reviver);
        const first = math.solveEquation(equation, 'variable_θ');
        const second = math.solveEquation(restored, 'variable_θ');

        expect(second).toEqual(first);
        expect(equation.toString()).toBe(restored.toString());
      }
    ), {seed: 20260903, numRuns: 100});
  });

  it('returns degree-many verified complex roots for generated roots of unity', () => {
    const math = createMath();
    fc.assert(fc.property(
      fc.integer({min: 2, max: 16}),
      (degree) => {
        const source = `x^${degree} - 1 =:= 0`;
        const result = math.solveEquation(source, 'x', {domain: 'complex'});
        expect(result.kind).toBe('finite');
        if (result.kind === 'finite') {
          expect(result.solutions.reduce(
            (sum, solution) => sum + (solution.multiplicity ?? 1),
            0
          )).toBe(degree);
          expect(result.solutions.every((solution) =>
            solution.verification.status === 'proven' &&
            (solution.verification.evidence?.residual ?? Infinity) < 1e-8
          )).toBe(true);
        }
      }
    ), {seed: 20260903, numRuns: 30});
  }, 30_000);
});
