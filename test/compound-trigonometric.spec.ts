import {all, create} from 'mathjs';
import fc from 'fast-check';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import type {
  ParametricFamily,
  ParametricSolutions,
  PartialResult,
  SolveResult,
  symbolicjsInstance
} from '../src/index.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

function resultFamilies(result: SolveResult): readonly ParametricFamily[] {
  if (result.kind === 'parametric') {
    return result.families;
  }
  if (result.kind === 'partial' && result.families) {
    return result.families;
  }
  throw new Error(`Expected family result, received ${result.kind}`);
}

function verifyFamilies(
  math: symbolicjsInstance,
  source: string,
  result: SolveResult,
  scope: Record<string, number> = {}
): void {
  const equation = math.parseEquation(source);
  for (const family of resultFamilies(result)) {
    const parameter = family.parameters[0]!.name;
    for (const integer of [-3, -1, 0, 2, 4]) {
      const x = Number(math.instantiateFamily(family, {
        [parameter]: integer
      }).compile().evaluate(scope));
      const evaluationScope = {...scope, x};
      const lhs = Number(equation.lhs.compile().evaluate(evaluationScope));
      const rhs = Number(equation.rhs.compile().evaluate(evaluationScope));
      expect(Math.abs(lhs - rhs)).toBeLessThanOrEqual(
        1e-9 * Math.max(1, Math.abs(lhs), Math.abs(rhs))
      );
    }
  }
}

function materializedValues(
  math: symbolicjsInstance,
  result: ParametricSolutions
): number[] {
  const finite = math.materializeSolutions(result, {
    lower: -2 * Math.PI,
    upper: 2 * Math.PI
  });
  expect(finite.kind).toBe('finite');
  return finite.kind === 'finite'
    ? finite.solutions.map((solution) => Number(solution.value.compile().evaluate()))
    : [];
}

describe('compound trigonometric identities', () => {
  it('classifies the Pythagorean identity and contradiction', () => {
    const math = createMath();

    expect(math.solveEquation('sin(x)^2 + cos(x)^2 =:= 1', 'x').kind)
      .toBe('identity');
    expect(math.solveEquation('cos(x)^2 + sin(x)^2 =:= 2', 'x').kind)
      .toBe('contradiction');
  });

  it('reduces the sine-cosine product through the double angle', () => {
    const math = createMath();
    const zero = math.solveEquation('sin(x)*cos(x) =:= 0', 'x');
    const nonzero = math.solveEquation('cos(x)*sin(x) =:= 1/4', 'x');

    expect(resultFamilies(zero)).toHaveLength(1);
    expect(resultFamilies(nonzero)).toHaveLength(2);
    verifyFamilies(math, 'sin(x)*cos(x) =:= 0', zero);
    verifyFamilies(math, 'cos(x)*sin(x) =:= 1/4', nonzero);
  });

  it('normalizes odd and even negative arguments without changing roots', () => {
    const math = createMath();
    const sine = math.solveEquation('sin(-x) + sin(x) =:= 0', 'x');
    const cosine = math.solveEquation('cos(-x) - cos(x) =:= 0', 'x');

    expect(sine.kind).toBe('identity');
    expect(cosine.kind).toBe('identity');
  });
});

describe('polynomials in one trigonometric atom', () => {
  it('lifts squared sine and cosine roots to complete families', () => {
    const math = createMath();
    const sine = math.solveEquation('sin(x)^2 =:= 1/4', 'x');
    const cosine = math.solveEquation('cos(x)^2 =:= 1/4', 'x');

    expect(resultFamilies(sine)).toHaveLength(4);
    expect(resultFamilies(cosine)).toHaveLength(4);
    verifyFamilies(math, 'sin(x)^2 =:= 1/4', sine);
    verifyFamilies(math, 'cos(x)^2 =:= 1/4', cosine);
  });

  it('solves a quadratic in sine and deduplicates lifted families', () => {
    const math = createMath();
    const source = '2*sin(x)^2 - 3*sin(x) + 1 =:= 0';
    const result = math.solveEquation(source, 'x');

    expect(resultFamilies(result)).toHaveLength(3);
    verifyFamilies(math, source, result);
  });

  it('filters auxiliary roots outside the function range', () => {
    const math = createMath();
    const result = math.solveEquation('(sin(x)-2)*(sin(x)-1/2) =:= 0', 'x');

    expect(resultFamilies(result)).toHaveLength(2);
    verifyFamilies(math, '(sin(x)-2)*(sin(x)-1/2) =:= 0', result);
  });
});

describe('amplitude-phase reduction', () => {
  it('solves sine equal to cosine', () => {
    const math = createMath();
    const source = 'sin(x) =:= cos(x)';
    const result = math.solveEquation(source, 'x');

    expect(result.kind).toBe('parametric');
    expect(resultFamilies(result)).toHaveLength(1);
    verifyFamilies(math, source, result);
  });

  it('solves a numeric same-argument linear combination', () => {
    const math = createMath();
    const source = '2*sin(x) + 2*cos(x) =:= 1';
    const result = math.solveEquation(source, 'x');

    expect(result.kind).toBe('parametric');
    expect(resultFamilies(result)).toHaveLength(2);
    verifyFamilies(math, source, result);
  });

  it('preserves symbolic amplitude and range conditions as partial', () => {
    const math = createMath();
    const result = math.solveEquation('a*sin(x) + b*cos(x) =:= c', 'x');
    const conditions = resultFamilies(result).flatMap((family) => family.conditions);

    expect(result.kind).toBe('partial');
    expect(conditions.some((condition) => condition.kind === 'positive')).toBe(true);
    expect(conditions.some((condition) => condition.kind === 'nonnegative')).toBe(true);
  });

  it('is invariant under equation sign and side changes', () => {
    const math = createMath();
    const first = math.solveEquation('sin(x) =:= cos(x)', 'x');
    const second = math.solveEquation('-cos(x) =:= -sin(x)', 'x');
    const firstValues = materializedValues(math, first as ParametricSolutions);
    const secondValues = materializedValues(math, second as ParametricSolutions);

    expect(firstValues).toHaveLength(secondValues.length);
    firstValues.forEach((value, index) => {
      expect(value).toBeCloseTo(secondValues[index]!, 10);
    });
  });

  it('rejects mixed arguments and frequencies', () => {
    const math = createMath();

    expect(math.solveEquation('sin(x) + cos(2*x) =:= 0', 'x')).toEqual({
      kind: 'unsupported', target: 'x', reason: 'unsupported-trig-form'
    });
    expect(math.solveEquation('sin(x) + sin(sqrt(2)*x) =:= 0', 'x')).toEqual({
      kind: 'unsupported', target: 'x', reason: 'unsupported-trig-form'
    });
  });
});

describe('compound trig budgets and diagnostics', () => {
  it.each([
    [{rewriteSteps: 0}, 'rewrite-steps'],
    [{symbolicExpressionNodes: 0}, 'symbolic-expression-nodes'],
    [{totalWork: 0}, 'total-work']
  ] as const)('enforces rewrite budget %s', (limits, limit) => {
    expect(createMath().solveEquation('sin(x)*cos(x) =:= 0', 'x', {limits}))
      .toEqual({kind: 'limit', target: 'x', limit});
  });

  it('propagates lifted branch and family limits', () => {
    const math = createMath();
    const source = 'sin(x)^2 =:= 1/4';

    expect(math.solveEquation(source, 'x', {limits: {branches: 1}}).kind)
      .toBe('limit');
    expect(math.solveEquation(source, 'x', {limits: {parametricFamilies: 1}}).kind)
      .toBe('limit');
  });

  it('records the compound dispatch stage', () => {
    const result = createMath().solveEquation('sin(x) =:= cos(x)', 'x', {
      diagnostics: true
    });

    expect(result.diagnostics?.steps.some((step) =>
      step.rule === 'compound-trigonometric' && step.outcome === 'parametric'
    )).toBe(true);
  });

  it('proves generated affine Pythagorean identities', () => {
    const math = createMath();
    fc.assert(fc.property(
      fc.integer({min: -5, max: 5}).filter((value) => value !== 0),
      fc.integer({min: -10, max: 10}),
      (coefficient, offset) => {
        const inner = `(${coefficient})*x+(${offset})`;
        expect(math.solveEquation(
          `sin(${inner})^2 + cos(${inner})^2 =:= 1`,
          'x'
        ).kind).toBe('identity');
      }
    ), {seed: 20260903, numRuns: 75});
  });
});

