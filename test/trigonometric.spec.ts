import {all, create} from 'mathjs';
import fc from 'fast-check';
import {describe, expect, it} from 'vitest';
import {
  CIRCULAR_FUNCTIONS,
  importsymbolicjs
} from '../src/index.js';
import type {
  FiniteSolutions,
  ParametricSolutions,
  PartialResult,
  SolveResult,
  symbolicjsInstance
} from '../src/index.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

function parametric(result: SolveResult): ParametricSolutions {
  expect(result.kind).toBe('parametric');
  return result as ParametricSolutions;
}

function finiteValues(
  result: SolveResult,
  scope: Record<string, number> = {}
): number[] {
  expect(['finite', 'partial']).toContain(result.kind);
  return (result as FiniteSolutions | PartialResult).solutions.map((solution) =>
    Number(solution.value.compile().evaluate(scope))
  ).sort((left, right) => left - right);
}

function expectFamilySamples(
  math: symbolicjsInstance,
  source: string,
  result: SolveResult,
  scope: Record<string, number> = {}
): void {
  const equation = math.parseEquation(source);
  for (const family of parametric(result).families) {
    expect(math.verifyParametricFamily(equation, 'x', family).status)
      .not.toBe('rejected');
    const parameter = family.parameters[0]!.name;
    for (const integer of [-3, -1, 0, 2, 5]) {
      const value = Number(math.instantiateFamily(family, {
        [parameter]: integer
      }).compile().evaluate(scope));
      expect(Number.isFinite(value)).toBe(true);
      const equationScope = {...scope, x: value};
      const lhs = Number(equation.lhs.compile().evaluate(equationScope));
      const rhs = Number(equation.rhs.compile().evaluate(equationScope));
      expect(Math.abs(lhs - rhs)).toBeLessThanOrEqual(
        1e-10 * Math.max(1, Math.abs(lhs), Math.abs(rhs))
      );
    }
  }
}

describe('circular function registry', () => {
  it('describes all six circular functions immutably', () => {
    expect(Object.keys(CIRCULAR_FUNCTIONS)).toEqual([
      'sin', 'cos', 'tan', 'sec', 'csc', 'cot'
    ]);
    expect(CIRCULAR_FUNCTIONS.sin).toEqual({
      inverse: 'asin', periodMultiplier: 2, bounded: true, parity: 'odd'
    });
    expect(Object.isFrozen(CIRCULAR_FUNCTIONS)).toBe(true);
    expect(Object.values(CIRCULAR_FUNCTIONS).every(Object.isFrozen)).toBe(true);
  });
});

describe('isolated sine, cosine, and tangent', () => {
  it('uses compact special-value families', () => {
    const math = createMath();
    const sine = parametric(math.solveEquation('sin(x) =:= 0', 'x'));
    const cosineZero = parametric(math.solveEquation('cos(x) =:= 0', 'x'));
    const cosineOne = parametric(math.solveEquation('cos(x) =:= 1', 'x'));
    const sineMaximum = parametric(math.solveEquation('sin(x) =:= 1', 'x'));
    const sineMinimum = parametric(math.solveEquation('sin(x) =:= -1', 'x'));
    const cosineMinimum = parametric(math.solveEquation('cos(x) =:= -1', 'x'));

    expect(sine.families).toHaveLength(1);
    expect(cosineZero.families).toHaveLength(1);
    expect(cosineOne.families).toHaveLength(1);
    expect(sineMaximum.families).toHaveLength(1);
    expect(sineMinimum.families).toHaveLength(1);
    expect(cosineMinimum.families).toHaveLength(1);
    expectFamilySamples(math, 'sin(x) =:= 0', sine);
    expectFamilySamples(math, 'cos(x) =:= 0', cosineZero);
    expectFamilySamples(math, 'cos(x) =:= 1', cosineOne);
    expectFamilySamples(math, 'sin(x) =:= 1', sineMaximum);
    expectFamilySamples(math, 'sin(x) =:= -1', sineMinimum);
    expectFamilySamples(math, 'cos(x) =:= -1', cosineMinimum);
  });

  it('returns both complete sine and cosine branches', () => {
    const math = createMath();
    const sine = math.solveEquation('sin(x) =:= 1/2', 'x');
    const cosine = math.solveEquation('cos(x) =:= 1/2', 'x');

    expect(parametric(sine).families).toHaveLength(2);
    expect(parametric(cosine).families).toHaveLength(2);
    expectFamilySamples(math, 'sin(x) =:= 1/2', sine);
    expectFamilySamples(math, 'cos(x) =:= 1/2', cosine);
  });

  it('solves affine inner arguments and outer arithmetic', () => {
    const math = createMath();
    const cosine = math.solveEquation('cos(2*x + 1) =:= a', 'x');
    const tangent = math.solveEquation('tan(3 - x) =:= b', 'x');
    const scaled = math.solveEquation('2*sin(x) + 1 =:= 2', 'x');

    expect(parametric(cosine).families).toHaveLength(2);
    expect(parametric(tangent).families).toHaveLength(1);
    expect(parametric(scaled).families).toHaveLength(2);
    expectFamilySamples(math, 'cos(2*x + 1) =:= a', cosine, {a: 0.25});
    expectFamilySamples(math, 'tan(3 - x) =:= b', tangent, {b: 0.4});
    expectFamilySamples(math, '2*sin(x) + 1 =:= 2', scaled);
  });

  it('retains symbolic range and affine coefficient conditions', () => {
    const math = createMath();
    const result = parametric(math.solveEquation('sin(a*x+b) =:= c', 'x'));
    const conditions = result.families.flatMap((family) => family.conditions.map(
      (condition) => `${condition.kind}:${condition.expression.toString()}`
    ));

    expect(conditions.some((condition) => condition.startsWith('nonnegative:')))
      .toBe(true);
    expect(conditions).toContain('nonzero:a');
  });

  it('returns contradiction for numeric values outside sine/cosine range', () => {
    const math = createMath();

    expect(math.solveEquation('sin(x) =:= 2', 'x').kind).toBe('contradiction');
    expect(math.solveEquation('cos(x) =:= -2', 'x').kind).toBe('contradiction');
  });

  it('avoids parameter capture', () => {
    const math = createMath();
    const result = parametric(math.solveEquation('sin(x) =:= _k0', 'x'));

    expect(result.families.every((family) => family.parameters[0]?.name === '_k1'))
      .toBe(true);
  });

  it('avoids a colliding internal placeholder name', () => {
    const math = createMath();
    const result = math.solveEquation(
      'sin(x) =:= __symbolicjs_trig_atom',
      'x'
    );

    expect(result.kind).toBe('parametric');
  });

  it('rejects non-affine and target-dependent mixed forms precisely', () => {
    const math = createMath();

    expect(math.solveEquation('sin(x^2) =:= 0', 'x')).toEqual({
      kind: 'unsupported', target: 'x', reason: 'unsupported-trig-form'
    });
    expect(math.solveEquation('sin(x) + x =:= 0', 'x')).toEqual({
      kind: 'unsupported', target: 'x', reason: 'unsupported-trig-form'
    });
    expect(math.solveEquation('sin(x) =:= cos(x)', 'x').kind).toBe('parametric');
  });
});

describe('reciprocal circular functions', () => {
  it.each([
    ['sec(x) =:= 2', 2],
    ['csc(x) =:= -2', 2],
    ['cot(x) =:= 0', 1],
    ['cot(x) =:= 2', 1]
  ] as const)('solves %s', (source, familyCount) => {
    const math = createMath();
    const result = math.solveEquation(source, 'x');

    expect(parametric(result).families).toHaveLength(familyCount);
    expectFamilySamples(math, source, result);
  });

  it('returns contradictions for impossible reciprocal values', () => {
    const math = createMath();

    expect(math.solveEquation('sec(x) =:= 0', 'x').kind).toBe('contradiction');
    expect(math.solveEquation('csc(x) =:= 1/2', 'x').kind).toBe('contradiction');
  });

  it('preserves zero and nonzero conditional cotangent branches', () => {
    const math = createMath();
    const result = parametric(math.solveEquation('cot(x) =:= a', 'x'));
    const kinds = result.families.flatMap((family) =>
      family.conditions.map((condition) => condition.kind)
    );

    expect(result.families).toHaveLength(2);
    expect(kinds).toContain('zero');
    expect(kinds).toContain('nonzero');
  });
});

describe('inverse circular functions', () => {
  it.each([
    ['asin(x) =:= pi/6', 0.5],
    ['acos(x) =:= pi/3', 0.5],
    ['atan(x) =:= pi/4', 1]
  ] as const)('solves %s', (source, expected) => {
    const result = createMath().solveEquation(source, 'x');

    expect(finiteValues(result)[0]).toBeCloseTo(expected, 12);
  });

  it.each([
    'asin(x) =:= pi',
    'acos(x) =:= -1',
    'atan(x) =:= pi/2'
  ])('rejects a value outside the principal range: %s', (source) => {
    expect(createMath().solveEquation(source, 'x').kind).toBe('contradiction');
  });

  it('attaches symbolic principal-range conditions', () => {
    const math = createMath();
    const results = [
      math.solveEquation('asin(x) =:= a', 'x'),
      math.solveEquation('acos(x) =:= a', 'x'),
      math.solveEquation('atan(x) =:= a', 'x')
    ];

    expect(results.every((result) => result.kind === 'partial')).toBe(true);
    expect(results.every((result) =>
      (result as PartialResult).solutions[0]!.conditions.length === 2
    )).toBe(true);
  });

  it('rejects inverse functions with non-affine inner arguments', () => {
    expect(createMath().solveEquation('asin(x^2) =:= 0', 'x')).toEqual({
      kind: 'unsupported', target: 'x', reason: 'unsupported-trig-form'
    });
  });
});

describe('trigonometric integration, diagnostics, and limits', () => {
  it('materializes complete families over a finite interval', () => {
    const math = createMath();
    const result = parametric(math.solveEquation('sin(x) =:= 0', 'x'));
    const materialized = math.materializeSolutions(result, {
      lower: -2 * Math.PI,
      upper: 2 * Math.PI
    });

    const values = finiteValues(materialized);
    expect(values).toHaveLength(5);
    expect(values[0]).toBeCloseTo(-2 * Math.PI, 12);
    expect(values[4]).toBeCloseTo(2 * Math.PI, 12);
  });

  it('records trigonometric dispatch and construction verification', () => {
    const result = parametric(createMath().solveEquation('sin(x) =:= 0', 'x', {
      diagnostics: true
    }));

    expect(result.diagnostics?.steps.some((step) => step.rule === 'trigonometric'))
      .toBe(true);
    expect(result.families.every((family) =>
      family.verification.evidence?.method === 'construction' &&
      family.certificate?.kind === 'periodic'
    )).toBe(true);
  });

  it('keeps the real-only trig boundary explicit', () => {
    expect(createMath().solveEquation('sin(x) =:= 0', 'x', {domain: 'complex'}))
      .toEqual({kind: 'unsupported', target: 'x', reason: 'unsupported-domain'});
  });

  it.each([
    [{branches: 0}, 'branches'],
    [{parametricFamilies: 0}, 'parametric-families'],
    [{totalWork: 0}, 'total-work']
  ] as const)('enforces %s', (limits, limit) => {
    expect(createMath().solveEquation('sin(x) =:= 1/2', 'x', {limits})).toEqual({
      kind: 'limit', target: 'x', limit
    });
  });

  it('propagates a polynomial limit from trig preprocessing', () => {
    expect(createMath().solveEquation('sin(x) =:= 1/2', 'x', {
      limits: {polynomialDegree: 0}
    })).toEqual({kind: 'limit', target: 'x', limit: 'polynomial-degree'});
  });

  it('supports configured BigNumber constants', () => {
    const math = importsymbolicjs(create(all!, {number: 'BigNumber'}));
    const result = math.solveEquation('sin(x) =:= 0.5', 'x');

    expect(parametric(result).families).toHaveLength(2);
  });

  it('solves generated affine sine equations by reconstruction', () => {
    const math = createMath();
    fc.assert(fc.property(
      fc.integer({min: -5, max: 5}).filter((value) => value !== 0),
      fc.integer({min: -8, max: 8}),
      fc.integer({min: -8, max: 8}).map((value) => value / 10),
      (coefficient, offset, rhs) => {
        const source = `sin((${coefficient})*x + (${offset})) =:= ${rhs}`;
        const result = math.solveEquation(source, 'x');
        expect(parametric(result).families).toHaveLength(rhs === 0 ? 1 : 2);
        expectFamilySamples(math, source, result);
      }
    ), {seed: 20260903, numRuns: 50});
  });
});
