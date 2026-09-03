import {all, create} from 'mathjs';
import fc from 'fast-check';
import {describe, expect, it} from 'vitest';
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

function conditionHolds(
  condition: Condition,
  scope: Readonly<Record<string, number>>,
  tolerance = 1e-9
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
  result: SolveResult,
  scope: Readonly<Record<string, number>>
): readonly Solution[] {
  expect(result.kind).toBe('partial');
  return (result as PartialResult).solutions.filter((solution) =>
    solution.conditions.every((condition) => conditionHolds(condition, scope))
  );
}

function values(
  solutions: readonly Solution[],
  scope: Readonly<Record<string, number>>
): number[] {
  return solutions.map((solution) =>
    Number(solution.value.compile().evaluate(scope))
  ).sort((left, right) => left - right);
}

function expectRoots(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((root, index) => {
    expect(actual[index]).toBeCloseTo(root, 9);
  });
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
      1e-8 * Math.max(1, Math.abs(lhs), Math.abs(rhs))
    );
  }
}

const generalSource = 'a*x^3 + b*x^2 + c*x + d =:= 0';

describe('symbolic cubic construction', () => {
  it('emits all conditional discriminant branches with frozen certificates', () => {
    const result = createMath().solveEquation(generalSource, 'x');

    expect(result.kind).toBe('partial');
    const solutions = (result as PartialResult).solutions;
    expect(solutions).toHaveLength(7);
    expect(new Set(solutions.map((solution) => solution.certificate?.branch)))
      .toEqual(new Set([
        'one-real',
        'triple-root',
        'simple-and-double',
        'three-real'
      ]));
    for (const solution of solutions) {
      expect(solution.exact).toBe(true);
      expect(solution.verification).toEqual({
        status: 'proven', evidence: {method: 'construction'}
      });
      expect(solution.certificate?.kind).toBe('cubic');
      expect(Object.isFrozen(solution.certificate)).toBe(true);
      expect(Object.isFrozen(solution.certificate?.coefficients)).toBe(true);
      expect(solution.conditions.some((condition) =>
        condition.kind === 'nonzero' && condition.expression.toString() === 'a'
      )).toBe(true);
    }
  });

  it.each([
    [{a: 1, b: -6, c: 11, d: -6}, [1, 2, 3]],
    [{a: 1, b: 0, c: 1, d: 1}, [-0.6823278038280193]],
    [{a: 1, b: 0, c: -3, d: 1}, [
      -1.8793852415718169,
      0.3472963553338607,
      1.532088886237956
    ]],
    [{a: 1, b: -3, c: 3, d: -1}, [1]],
    [{a: 1, b: 0, c: -3, d: 2}, [-2, 1]]
  ] as const)('selects and verifies the real roots under scope %#', (scope, expected) => {
    const math = createMath();
    const result = math.solveEquation(generalSource, 'x');
    const active = activeSolutions(result, scope);

    expectRoots(values(active, scope), expected);
    expectResiduals(math, generalSource, active, scope);
  });

  it('uses real cube roots for the one-real-root branch', () => {
    const result = createMath().solveEquation(generalSource, 'x') as PartialResult;
    const solution = result.solutions.find((candidate) =>
      candidate.certificate?.branch === 'one-real'
    )!;

    expect(solution.value.toString()).toContain('nthRoot');
    expect(solution.value.toString()).not.toContain('^ (1 / 3)');
  });

  it('uses the exact trigonometric form for three real roots', () => {
    const result = createMath().solveEquation(generalSource, 'x') as PartialResult;
    const solutions = result.solutions.filter((candidate) =>
      candidate.certificate?.branch === 'three-real'
    );

    expect(solutions).toHaveLength(3);
    expect(solutions.every((solution) =>
      solution.value.toString().includes('acos') &&
      solution.value.toString().includes('cos')
    )).toBe(true);
  });

  it('records triple and double multiplicities on the zero-discriminant branches', () => {
    const math = createMath();
    const result = math.solveEquation(generalSource, 'x');
    const triple = activeSolutions(result, {a: 1, b: -3, c: 3, d: -1});
    const repeated = activeSolutions(result, {a: 1, b: 0, c: -3, d: 2});

    expect(triple.map((solution) => solution.multiplicity)).toEqual([3]);
    expect(repeated.map((solution) => solution.multiplicity).sort())
      .toEqual([1, 2]);
  });

  it('makes mutually exclusive branch conditions observable', () => {
    const result = createMath().solveEquation(generalSource, 'x') as PartialResult;
    const oneRealScope = {a: 1, b: 0, c: 1, d: 1};
    const active = result.solutions.filter((solution) =>
      solution.conditions.every((condition) => conditionHolds(condition, oneRealScope))
    );
    const inactive = result.solutions.filter((solution) => !active.includes(solution));

    expect(active).toHaveLength(1);
    expect(active[0]?.certificate?.branch).toBe('one-real');
    expect(inactive.every((solution) => solution.conditions.some((condition) =>
      !conditionHolds(condition, oneRealScope)
    ))).toBe(true);
  });
});

describe('cubic degeneration and invariants', () => {
  it('dispatches an actual zero leading coefficient to the quadratic solver', () => {
    const math = createMath();
    const cubic = math.solveEquation('0*x^3 + x^2 - 5*x + 6 =:= 0', 'x');
    const quadratic = math.solveEquation('x^2 - 5*x + 6 =:= 0', 'x');

    expect(cubic).toEqual(quadratic);
  });

  it('preserves roots under nonzero numeric scaling', () => {
    const math = createMath();
    const base = math.solveEquation('x^3 - 6*x^2 + 11*x - 6 =:= 0', 'x');
    const scaled = math.solveEquation('-17*(x^3 - 6*x^2 + 11*x - 6) =:= 0', 'x');

    expectRoots(
      values((base as FiniteSolutions).solutions, {}),
      values((scaled as FiniteSolutions).solutions, {})
    );
  });

  it('keeps an already isolated symbolic cube compact', () => {
    const result = createMath().solveEquation('(x-a)^3 =:= 0', 'x');

    expect(result.kind).toBe('partial');
    expect((result as PartialResult).solutions).toHaveLength(1);
    expect((result as PartialResult).solutions[0]?.value.toString()).not.toContain('acos');
  });

  it('solves generated rational-root cubics independently of term order and scale', () => {
    const math = createMath();
    fc.assert(fc.property(
      fc.integer({min: -5, max: 5}),
      fc.integer({min: -5, max: 5}),
      fc.integer({min: -5, max: 5}),
      fc.integer({min: -5, max: 5}).filter((scale) => scale !== 0),
      (first, second, third, scale) => {
        const result = math.solveEquation(
          `${scale}*((x-(${third}))*(x-(${first}))*(x-(${second}))) =:= 0`,
          'x'
        ) as FiniteSolutions;
        const expected = [...new Set([first, second, third])]
          .sort((left, right) => left - right);
        expectRoots(values(result.solutions, {}), expected);
      }
    ), {seed: 20260903, numRuns: 75});
  });
});

describe('symbolic cubic budgets', () => {
  it.each([
    [{symbolicExpressionNodes: 0}, 'symbolic-expression-nodes'],
    [{branches: 0}, 'branches'],
    [{candidates: 0}, 'candidates'],
    [{totalWork: 0}, 'total-work']
  ] as const)('enforces %s', (limits, limit) => {
    expect(createMath().solveEquation(generalSource, 'x', {limits}))
      .toEqual({kind: 'limit', target: 'x', limit});
  });

  it('never returns the retired symbolic-cubic gap', () => {
    const result = createMath().solveEquation(generalSource, 'x');

    expect(result.kind).not.toBe('unsupported');
    if (result.kind === 'unsupported') {
      expect(result.reason).not.toBe('symbolic-cubic');
    }
  });
});
