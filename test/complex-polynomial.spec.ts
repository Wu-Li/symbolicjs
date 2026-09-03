import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import type {
  FiniteSolutions,
  PartialResult,
  SolveResult,
  symbolicjsInstance
} from '../src/index.js';

interface ComplexParts {
  readonly re: number;
  readonly im: number;
}

function createMath() {
  return importsymbolicjs(create(all!));
}

function parts(value: unknown): ComplexParts {
  if (typeof value === 'number') {
    return {re: value, im: 0};
  }
  if (
    value &&
    typeof value === 'object' &&
    're' in value &&
    'im' in value &&
    typeof value.re === 'number' &&
    typeof value.im === 'number'
  ) {
    return {re: value.re, im: value.im};
  }
  throw new TypeError('Expected a finite scalar');
}

function finite(result: SolveResult): FiniteSolutions {
  expect(result.kind).toBe('finite');
  return result as FiniteSolutions;
}

function values(result: FiniteSolutions): ComplexParts[] {
  return result.solutions.map((solution) =>
    parts(solution.value.compile().evaluate())
  );
}

function expectComplexClose(
  actual: ComplexParts,
  expected: ComplexParts,
  precision = 9
): void {
  expect(actual.re).toBeCloseTo(expected.re, precision);
  expect(actual.im).toBeCloseTo(expected.im, precision);
}

function expectVerified(
  math: symbolicjsInstance,
  source: string,
  result: FiniteSolutions
): void {
  const equation = math.parseEquation(source);
  for (const solution of result.solutions) {
    expect(solution.verification.status).toBe('proven');
    expect(solution.verification.evidence?.method).toBe('residual');
    expect(math.symbolicKernel.verify(equation, 'x', solution.value).status)
      .toBe('proven');
  }
}

describe('explicit complex polynomial domain', () => {
  it('returns both roots of x^2 + 1 in canonical order', () => {
    const math = createMath();
    const result = finite(math.solveEquation('x^2 + 1 =:= 0', 'x', {
      domain: 'complex'
    }));

    expect(values(result)).toEqual([{re: 0, im: -1}, {re: 0, im: 1}]);
    expect(result.scope).toEqual({domain: 'complex', completeness: 'complete'});
    expect(result.solutions.every((solution) => !solution.exact)).toBe(true);
    expectVerified(math, 'x^2 + 1 =:= 0', result);
  });

  it('returns every cubic and quartic branch', () => {
    const math = createMath();
    const cubic = finite(math.solveEquation('x^3 - 1 =:= 0', 'x', {
      domain: 'complex'
    }));
    const quartic = finite(math.solveEquation('x^4 + 1 =:= 0', 'x', {
      domain: 'complex'
    }));

    const cubicValues = values(cubic);
    expectComplexClose(cubicValues[0]!, {re: -0.5, im: -Math.sqrt(3) / 2});
    expectComplexClose(cubicValues[1]!, {re: -0.5, im: Math.sqrt(3) / 2});
    expectComplexClose(cubicValues[2]!, {re: 1, im: 0});
    expect(quartic.solutions).toHaveLength(4);
    values(quartic).forEach((value) =>
      expect(Math.hypot(value.re, value.im)).toBeCloseTo(1, 10)
    );
    expectVerified(math, 'x^3 - 1 =:= 0', cubic);
    expectVerified(math, 'x^4 + 1 =:= 0', quartic);
  });

  it('returns all higher-degree roots of unity with conserved degree', () => {
    const math = createMath();
    const result = finite(math.solveEquation('x^12 - 1 =:= 0', 'x', {
      domain: 'complex'
    }));

    expect(result.solutions).toHaveLength(12);
    expect(result.solutions.reduce(
      (sum, solution) => sum + (solution.multiplicity ?? 1),
      0
    )).toBe(12);
    for (const value of values(result)) {
      expect(Math.hypot(value.re, value.im)).toBeCloseTo(1, 9);
    }
    expectVerified(math, 'x^12 - 1 =:= 0', result);
  });

  it('normalizes conjugate pairs and zero components deterministically', () => {
    const math = createMath();
    const result = finite(math.solveEquation('(x^2 + 1)^2 =:= 0', 'x', {
      domain: 'complex',
      limits: {numericIterations: 2_000}
    }));
    const actual = values(result);

    expect(actual).toHaveLength(2);
    expect(actual[0]?.re).toBe(0);
    expect(actual[1]?.re).toBe(0);
    expect(Object.is(actual[0]?.re, -0)).toBe(false);
    expectComplexClose(actual[0]!, {re: 0, im: -1}, 7);
    expectComplexClose(actual[1]!, {re: 0, im: 1}, 7);
    expect(result.solutions.map((solution) => solution.multiplicity)).toEqual([2, 2]);
  });

  it('keeps all real roots real and consistent with real mode', () => {
    const math = createMath();
    const source = '(x - 3)*(x + 2)*(x - 1) =:= 0';
    const real = finite(math.solveEquation(source, 'x'));
    const complex = finite(math.solveEquation(source, 'x', {domain: 'complex'}));

    values(complex).forEach((value, index) =>
      expectComplexClose(value, values(real)[index]!, 10)
    );
    expect(values(complex)).toEqual([
      {re: -2, im: 0},
      {re: 1, im: 0},
      {re: 3, im: 0}
    ]);
  });

  it('retains a symbolic leading-coefficient condition without real sign guards', () => {
    const math = createMath();
    const result = math.solveEquation('a*x^2 + b*x + c =:= 0', 'x', {
      domain: 'complex'
    }) as PartialResult;

    expect(result.kind).toBe('partial');
    expect(result.scope).toEqual({domain: 'complex', completeness: 'partial'});
    expect(result.solutions).toHaveLength(2);
    for (const solution of result.solutions) {
      expect(solution.conditions.map((condition) =>
        condition.kind + ':' + condition.expression.toString()
      )).toEqual(['nonzero:a']);
      expect(solution.conditions.every((condition) =>
        !['positive', 'negative', 'nonpositive', 'nonnegative'].includes(condition.kind)
      )).toBe(true);
      const value = parts(solution.value.compile().evaluate({a: 1, b: 0, c: 1}));
      expect(value.re).toBeCloseTo(0, 10);
      expect(Math.abs(value.im)).toBeCloseTo(1, 10);
    }
  });

  it('keeps complex-valued coefficient expressions typed and non-throwing', () => {
    const math = createMath();
    const result = math.solveEquation('sqrt(-1)*x^2 + 1 =:= 0', 'x', {
      domain: 'complex'
    });

    expect(result.kind).toBe('partial');
    expect((result as PartialResult).solutions).toHaveLength(2);
    for (const solution of (result as PartialResult).solutions) {
      const value = parts(solution.value.compile().evaluate());
      const squared = {
        re: value.re * value.re - value.im * value.im,
        im: 2 * value.re * value.im
      };
      const residual = {re: 1 - squared.im, im: squared.re};
      expect(Math.hypot(residual.re, residual.im)).toBeLessThan(1e-10);
    }
  });

  it('leaves implicit and explicit real-domain results unchanged', () => {
    const math = createMath();
    const source = 'x^4 - 5*x^2 + 4 =:= 0';

    expect(math.solveEquation(source, 'x', {domain: 'real'}))
      .toEqual(math.solveEquation(source, 'x'));
    expect(math.solveEquation('x^2 + 1 =:= 0', 'x').kind)
      .toBe('contradiction');
  });

  it('rejects complex transcendental and interval searches with typed outcomes', () => {
    const math = createMath();

    expect(math.solveEquation('sin(x) =:= 0', 'x', {domain: 'complex'}))
      .toEqual({kind: 'unsupported', target: 'x', reason: 'unsupported-domain'});
    expect(math.solveEquation('x^2 + 1 =:= 0', 'x', {
      domain: 'complex',
      numericFallback: true,
      interval: {lower: -1, upper: 1}
    })).toEqual({kind: 'unsupported', target: 'x', reason: 'unsupported-domain'});
  });

  it('uses complex-polynomial diagnostics and numeric degree budgets', () => {
    const math = createMath();
    const result = math.solveEquation('x^5 - 1 =:= 0', 'x', {
      domain: 'complex',
      diagnostics: true
    });

    expect(result.diagnostics?.steps.some((step) =>
      step.rule === 'complex-polynomial' && step.outcome === 'finite'
    )).toBe(true);
    expect(math.solveEquation('x^5 - 1 =:= 0', 'x', {
      domain: 'complex',
      limits: {numericPolynomialDegree: 4}
    })).toEqual({kind: 'limit', target: 'x', limit: 'numeric-polynomial-degree'});
  });
});
