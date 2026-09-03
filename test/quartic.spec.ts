import {all, create} from 'mathjs';
import fc from 'fast-check';
import {beforeAll, describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import type {
  Condition,
  FiniteSolutions,
  PartialResult,
  Solution,
  SolveResult,
  symbolicjsInstance
} from '../src/index.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

function finiteValues(result: SolveResult): number[] {
  expect(result.kind).toBe('finite');
  return (result as FiniteSolutions).solutions.map((solution) =>
    Number(solution.value.compile().evaluate())
  ).sort((left, right) => left - right);
}

function expectRoots(
  actual: readonly number[],
  expected: readonly number[],
  precision = 8
): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((root, index) => {
    expect(actual[index]).toBeCloseTo(root, precision);
  });
}

function conditionHolds(
  condition: Condition,
  scope: Readonly<Record<string, number>>,
  tolerance = 1e-8
): boolean {
  let value: unknown;
  try {
    value = condition.expression.compile().evaluate(scope);
  } catch {
    return false;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return false;
  }
  switch (condition.kind) {
    case 'zero': return Math.abs(numeric) <= tolerance;
    case 'nonzero': return Math.abs(numeric) > tolerance;
    case 'positive': return numeric > tolerance;
    case 'nonnegative': return numeric >= -tolerance;
    case 'negative': return numeric < -tolerance;
    case 'nonpositive': return numeric <= tolerance;
    case 'defined': return true;
  }
}

function activeSolutions(
  result: PartialResult,
  scope: Readonly<Record<string, number>>
): readonly Solution[] {
  return result.solutions.filter((solution) =>
    solution.conditions.every((condition) => conditionHolds(condition, scope))
  );
}

function scopedValues(
  solutions: readonly Solution[],
  scope: Readonly<Record<string, number>>
): number[] {
  return solutions.map((solution) =>
    Number(solution.value.compile().evaluate(scope))
  ).sort((left, right) => left - right);
}

function expectResiduals(
  math: symbolicjsInstance,
  source: string,
  solutions: readonly Solution[],
  scope: Readonly<Record<string, number>>
): void {
  const equation = math.parseEquation(source);
  for (const solution of solutions) {
    const x = Number(solution.value.compile().evaluate(scope));
    const evaluationScope = {...scope, x};
    const lhs = Number(equation.lhs.compile().evaluate(evaluationScope));
    const rhs = Number(equation.rhs.compile().evaluate(evaluationScope));
    expect(Math.abs(lhs - rhs)).toBeLessThanOrEqual(
      1e-7 * Math.max(1, Math.abs(lhs), Math.abs(rhs))
    );
  }
}

describe('numeric quartic solving', () => {
  it.each([
    ['x^4 - 5*x^2 + 4 =:= 0', [-2, -1, 1, 2]],
    ['x^4 - 10*x^2 + 9 =:= 0', [-3, -1, 1, 3]],
    ['x^4 - x =:= 0', [0, 1]],
    ['x^4 + x^2 - 2 =:= 0', [-1, 1]],
    ['x^4 - 2*x^3 - 7*x^2 + 8*x + 12 =:= 0', [-2, -1, 2, 3]]
  ] as const)('finds every distinct real root of %s', (source, expected) => {
    const result = createMath().solveEquation(source, 'x');

    expectRoots(finiteValues(result), expected);
    expect((result as FiniteSolutions).solutions.every((solution) =>
      solution.verification.status === 'proven' &&
      solution.certificate?.kind === 'quartic'
    )).toBe(true);
  });

  it('classifies quartics with no real roots as contradictions', () => {
    const math = createMath();

    expect(math.solveEquation('x^4 + 1 =:= 0', 'x').kind).toBe('contradiction');
    expect(math.solveEquation('x^4 + 2*x^2 + 1 =:= 0', 'x').kind)
      .toBe('contradiction');
  });

  it('retains repeated roots and multiplicity on polynomial construction paths', () => {
    const math = createMath();
    const repeated = math.solveEquation('x^4 - 2*x^2 + 1 =:= 0', 'x');

    expectRoots(finiteValues(repeated), [-1, 1]);
    expect((repeated as FiniteSolutions).solutions.map((solution) => solution.multiplicity))
      .toEqual([2, 2]);
    expectRoots(finiteValues(math.solveEquation('(x-1)^4 =:= 0', 'x')), [1]);
  });

  it('separates clustered real roots at the default tolerance', () => {
    const result = createMath().solveEquation(
      '(x-1)*(x-1.0001)*(x+2)*(x+3) =:= 0',
      'x'
    );

    expectRoots(finiteValues(result), [-3, -2, 1, 1.0001], 7);
  });

  it('records the Ferrari numeric dispatch', () => {
    const result = createMath().solveEquation('x^4 - x =:= 0', 'x', {
      diagnostics: true
    });

    expect(result.diagnostics?.steps.some((step) => step.rule === 'numeric-quartic'))
      .toBe(true);
  });
});

describe('symbolic biquadratic solving', () => {
  const source = 'a*x^4 + b*x^2 + c =:= 0';

  it.each([
    [{a: 1, b: -5, c: 4}, [-2, -1, 1, 2]],
    [{a: 1, b: 0, c: 1}, []],
    [{a: 1, b: -2, c: 1}, [-1, 1]]
  ] as const)('selects the correct conditional roots under scope %#', (scope, expected) => {
    const math = createMath();
    const result = math.solveEquation(source, 'x') as PartialResult;
    const active = activeSolutions(result, scope);

    expect(result.kind).toBe('partial');
    expectRoots(scopedValues(active, scope), expected);
    expectResiduals(math, source, active, scope);
  });

  it('uses only the compact biquadratic certificate path', () => {
    const result = createMath().solveEquation(source, 'x') as PartialResult;

    expect(result.solutions).toHaveLength(9);
    expect(result.solutions.every((solution) =>
      solution.certificate?.kind === 'quartic' &&
      solution.certificate.branch === 'biquadratic'
    )).toBe(true);
  });
});

describe('fully symbolic Ferrari construction', () => {
  const source = 'a*x^4 + b*x^3 + c*x^2 + d*x + e =:= 0';
  let math: symbolicjsInstance;
  let result: PartialResult;

  beforeAll(() => {
    math = createMath();
    result = math.solveEquation(source, 'x') as PartialResult;
  }, 60_000);

  it('covers the biquadratic and nonzero-linear depressed branches', () => {
    expect(result.kind).toBe('partial');
    expect(result.solutions).toHaveLength(33);
    expect(new Set(result.solutions.map((solution) => solution.certificate?.branch)))
      .toEqual(new Set(['biquadratic', 'ferrari']));
    expect(result.solutions.every((solution) =>
      solution.exact &&
      solution.verification.evidence?.method === 'construction' &&
      solution.conditions.some((condition) =>
        condition.kind === 'nonzero' && condition.expression.toString() === 'a'
      )
    )).toBe(true);
  });

  it.each([
    [{a: 1, b: 0, c: -5, d: 0, e: 4}, [-2, -1, 1, 2]],
    [{a: 1, b: -2, c: -7, d: 8, e: 12}, [-2, -1, 2, 3]],
    [{a: 1, b: -4, c: 6, d: -4, e: 1}, [1]],
    [{a: 1, b: 0, c: 0, d: 1, e: 1}, []]
  ] as const)('selects complete valid roots under scope %#', (scope, expected) => {
    const active = activeSolutions(result, scope);

    expectRoots(scopedValues(active, scope), expected);
    expectResiduals(math, source, active, scope);
  });

  it('freezes quartic construction metadata', () => {
    const certificate = result.solutions.find((solution) =>
      solution.certificate?.kind === 'quartic'
    )?.certificate;

    expect(Object.isFrozen(certificate)).toBe(true);
    expect(Object.isFrozen(certificate?.coefficients)).toBe(true);
  });
});

describe('quartic degeneration, properties, and budgets', () => {
  it('agrees with the cubic solver when the leading coefficient is zero', () => {
    const math = createMath();
    const quartic = math.solveEquation(
      '0*x^4 + x^3 - 6*x^2 + 11*x - 6 =:= 0',
      'x'
    );
    const cubic = math.solveEquation('x^3 - 6*x^2 + 11*x - 6 =:= 0', 'x');

    expect(quartic).toEqual(cubic);
  });

  it('solves generated quartics from shuffled rational roots and scale', () => {
    const math = createMath();
    fc.assert(fc.property(
      fc.integer({min: -4, max: 4}),
      fc.integer({min: -4, max: 4}),
      fc.integer({min: -4, max: 4}),
      fc.integer({min: -4, max: 4}),
      fc.integer({min: -4, max: 4}).filter((scale) => scale !== 0),
      (first, second, third, fourth, scale) => {
        const result = math.solveEquation(
          `${scale}*(x-(${third}))*(x-(${first}))*(x-(${fourth}))*(x-(${second})) =:= 0`,
          'x'
        );
        const expected = [...new Set([first, second, third, fourth])]
          .sort((left, right) => left - right);
        expectRoots(finiteValues(result), expected, 6);
      }
    ), {seed: 20260903, numRuns: 25});
  }, 60_000);

  it.each([
    [{polynomialDegree: 3}, 'polynomial-degree'],
    [{symbolicExpressionNodes: 0}, 'symbolic-expression-nodes'],
    [{branches: 0}, 'branches'],
    [{candidates: 0}, 'candidates'],
    [{totalWork: 0}, 'total-work']
  ] as const)('enforces %s', (limits, limit) => {
    const source = limit === 'polynomial-degree'
      ? 'x^4 - x =:= 0'
      : 'a*x^4 + b*x^3 + c*x^2 + d*x + e =:= 0';

    expect(createMath().solveEquation(source, 'x', {limits}))
      .toEqual({kind: 'limit', target: 'x', limit});
  });
});
