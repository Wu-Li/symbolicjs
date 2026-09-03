import {all, create} from 'mathjs';
import fc from 'fast-check';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import {
  findNumericPolynomialRoots,
  NumericPolynomialEngine
} from '../src/numeric-polynomial.js';
import type {
  NumericComplex,
  NumericPolynomialRoots
} from '../src/numeric-polynomial.js';
import type {FiniteSolutions, SolveResult} from '../src/index.js';

function multiplyPolynomials(left: readonly number[], right: readonly number[]): number[] {
  const result = Array.from({length: left.length + right.length - 1}, () => 0);
  left.forEach((leftValue, leftIndex) => {
    right.forEach((rightValue, rightIndex) => {
      result[leftIndex + rightIndex]! += leftValue * rightValue;
    });
  });
  return result;
}

function fromRealRoots(roots: readonly number[]): number[] {
  return roots.reduce<number[]>(
    (coefficients, root) => multiplyPolynomials(coefficients, [1, -root]),
    [1]
  );
}

function fromRootsAndPairs(
  roots: readonly number[],
  pairs: readonly NumericComplex[]
): number[] {
  let coefficients = fromRealRoots(roots);
  for (const pair of pairs) {
    coefficients = multiplyPolynomials(coefficients, [
      1,
      -2 * pair.re,
      pair.re * pair.re + pair.im * pair.im
    ]);
  }
  return coefficients;
}

const expandedLimits = {
  numericPolynomialDegree: 100,
  candidates: 128,
  numericIterations: 2_000,
  totalWork: 500_000
};

function roots(result: ReturnType<typeof findNumericPolynomialRoots>): NumericPolynomialRoots {
  expect(result.kind).toBe('roots');
  return result as NumericPolynomialRoots;
}

function realValues(result: NumericPolynomialRoots): number[] {
  return result.roots.filter((root) => root.value.im === 0)
    .map((root) => root.value.re)
    .sort((left, right) => left - right);
}

function expectRoots(
  actual: readonly number[],
  expected: readonly number[],
  precision = 7
): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => {
    expect(actual[index]).toBeCloseTo(value, precision);
  });
}

function finiteValues(result: SolveResult): number[] {
  expect(result.kind).toBe('finite');
  return (result as FiniteSolutions).solutions.map((solution) =>
    Number(solution.value.compile().evaluate())
  ).sort((left, right) => left - right);
}

describe('independent simultaneous numeric root engine', () => {
  it.each([
    [5, fromRealRoots([-2, -1, 0, 1, 2])],
    [10, fromRootsAndPairs([-3, -1, 1, 2], [
      {re: 0, im: 1},
      {re: 1, im: 2},
      {re: -2, im: 0.5}
    ])],
    [20, fromRealRoots(Array.from({length: 20}, (_, index) => (index - 10) / 10))],
    [50, [1, ...Array.from({length: 49}, () => 0), -1]],
    [100, [1, ...Array.from({length: 99}, () => 0), -1]]
  ] as const)('returns all %s roots with conserved multiplicity', (degree, coefficients) => {
    const result = roots(findNumericPolynomialRoots(coefficients, 'x', {
      limits: expandedLimits
    }));

    expect(result.roots.reduce((sum, root) => sum + root.multiplicity, 0))
      .toBe(degree);
    expect(result.roots.every((root) => root.residual <= 1e-9)).toBe(true);
  });

  it('preserves all-real degree-20 roots', () => {
    const expected = Array.from({length: 20}, (_, index) => (index - 10) / 10);
    const result = roots(findNumericPolynomialRoots(fromRealRoots(expected), 'x', {
      limits: expandedLimits
    }));

    expectRoots(realValues(result), expected, 5);
  });

  it('retains complex conjugate pairs for real coefficients', () => {
    const result = roots(findNumericPolynomialRoots(
      [1, ...Array.from({length: 19}, () => 0), -1],
      'x',
      {limits: expandedLimits}
    ));

    for (const root of result.roots.filter((candidate) => candidate.value.im > 0)) {
      expect(result.roots.some((candidate) =>
        Math.abs(candidate.value.re - root.value.re) <= 1e-10 &&
        Math.abs(candidate.value.im + root.value.im) <= 1e-10
      )).toBe(true);
    }
  });

  it('clusters repeated roots and deflates exact zero roots', () => {
    const expected = [-2, -1, -1, -1, 0, 0, 1, 1, 1, 2];
    const result = roots(findNumericPolynomialRoots(fromRealRoots(expected), 'x', {
      limits: expandedLimits
    }));

    expectRoots(realValues(result), [-2, -1, 0, 1, 2], 5);
    expect(result.roots.map((root) => root.multiplicity)).toEqual([1, 3, 2, 3, 1]);
  });

  it('is invariant to coefficient scaling and explicit leading zeros', () => {
    const coefficients = fromRealRoots([-3, -1, 2, 4, 5]);
    const base = roots(findNumericPolynomialRoots(coefficients, 'x'));
    const scaled = roots(findNumericPolynomialRoots(
      [0, 0, ...coefficients.map((coefficient) => coefficient * 1e-100)],
      'x'
    ));

    expectRoots(realValues(base), realValues(scaled), 8);
  });

  it('records backward accuracy for the Wilkinson degree-20 fixture', () => {
    const expected = Array.from({length: 20}, (_, index) => index + 1);
    const result = roots(findNumericPolynomialRoots(fromRealRoots(expected), 'x', {
      limits: {...expandedLimits, numericIterations: 10_000, totalWork: 1_000_000}
    }));
    const forwardErrors = result.roots.map((root, index) =>
      Math.abs(root.value.re - expected[index]!)
    );

    expect(result.roots).toHaveLength(20);
    expect(Math.max(...result.roots.map((root) => root.residual))).toBeLessThan(1e-10);
    expect(Math.max(...forwardErrors)).toBeGreaterThan(1e-3);
  });

  it('rejects malformed coefficient arrays', () => {
    const engine = new NumericPolynomialEngine();

    expect(() => engine.solve([1], 'x')).toThrow('at least two');
    expect(() => engine.solve([0, 0], 'x')).toThrow('identically zero');
    expect(() => engine.solve([1, Number.NaN], 'x')).toThrow('finite');
  });
});

describe('high-degree public polynomial integration', () => {
  it('solves degree five by the numeric polynomial engine', () => {
    const math = importsymbolicjs(create(all!));
    const result = math.solveEquation('x^5 - x =:= 0', 'x', {diagnostics: true});

    expectRoots(finiteValues(result), [-1, 0, 1]);
    expect((result as FiniteSolutions).solutions.every((solution) =>
      solution.verification.evidence?.method === 'residual'
    )).toBe(true);
    expect(result.diagnostics?.steps.some((step) => step.rule === 'numeric-polynomial'))
      .toBe(true);
  });

  it.each([
    [50, '(x^49 - 1)*(x + 2) =:= 0'],
    [100, '(x^99 - 1)*(x + 2) =:= 0']
  ] as const)('supports an opted-in degree-%i workload', (_degree, source) => {
    const math = importsymbolicjs(create(all!));
    const result = math.solveEquation(source, 'x', {limits: expandedLimits});

    expectRoots(finiteValues(result), [-2, 1]);
  });

  it('returns contradiction when every numeric root is non-real', () => {
    const result = importsymbolicjs(create(all!)).solveEquation(
      'x^6 + x^2 + 1 =:= 0',
      'x'
    );

    expect(result.kind).toBe('contradiction');
  });

  it('preserves repeated-root multiplicity in public results', () => {
    const result = importsymbolicjs(create(all!)).solveEquation(
      '(x-1)^3*(x+2)^2*(x-3) =:= 0',
      'x',
      {limits: {numericIterations: 2_000}}
    ) as FiniteSolutions;

    expectRoots(finiteValues(result), [-2, 1, 3], 5);
    expect(result.solutions.map((solution) => solution.multiplicity)).toEqual([2, 3, 1]);
  });

  it('generates and verifies bounded real-root polynomials', () => {
    const math = importsymbolicjs(create(all!));
    fc.assert(fc.property(
      fc.uniqueArray(fc.integer({min: -5, max: 5}), {minLength: 5, maxLength: 8}),
      (knownRoots) => {
        const factors = knownRoots.map((root) => `(x-(${root}))`).join('*');
        const result = math.solveEquation(`${factors} =:= 0`, 'x', {
          limits: {numericIterations: 1_000}
        });
        expectRoots(
          finiteValues(result),
          [...knownRoots].sort((left, right) => left - right),
          5
        );
      }
    ), {seed: 20260903, numRuns: 40});
  });
});

describe('numeric polynomial limits', () => {
  it.each([
    [{numericPolynomialDegree: 4}, 'numeric-polynomial-degree'],
    [{numericIterations: 0}, 'numeric-iterations'],
    [{candidates: 4}, 'candidates'],
    [{totalWork: 0}, 'total-work']
  ] as const)('returns a typed %s limit', (limits, limit) => {
    const result = importsymbolicjs(create(all!)).solveEquation(
      'x^5 - x =:= 0',
      'x',
      {limits}
    );

    expect(result).toEqual({kind: 'limit', target: 'x', limit});
  });

  it('keeps unsupported symbolic higher-degree inputs bounded', () => {
    const result = importsymbolicjs(create(all!)).solveEquation(
      'a*x^5 + x + 1 =:= 0',
      'x'
    );

    expect(result).toEqual({kind: 'limit', target: 'x', limit: 'polynomial-degree'});
  });
});
