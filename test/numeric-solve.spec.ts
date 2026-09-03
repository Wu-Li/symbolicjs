import {all, create} from 'mathjs';
import fc from 'fast-check';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import {
  numericSearchConditionHolds,
  numericSearchConditionSafelyHolds,
  numericSearchValue
} from '../src/numeric-solve.js';
import type {
  FiniteSolutions,
  PartialResult,
  SolveResult,
  symbolicjsInstance
} from '../src/index.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

function partial(result: SolveResult): PartialResult {
  expect(result.kind).toBe('partial');
  return result as PartialResult;
}

function values(result: SolveResult): number[] {
  return partial(result).solutions.map((solution) =>
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

function expectVerified(
  math: symbolicjsInstance,
  source: string,
  result: PartialResult
): void {
  const equation = math.parseEquation(source);
  for (const solution of result.solutions) {
    expect(solution.verification.status).toBe('proven');
    expect(math.symbolicKernel.verify(equation, 'x', solution.value).status)
      .toBe('proven');
  }
}

describe('bounded numeric fallback contract', () => {
  it('requires explicit enablement and a finite interval', () => {
    const math = createMath();

    expect(math.solveEquation('sin(x) + x =:= 0', 'x').kind).toBe('unsupported');
    expect(math.solveEquation('sin(x) + x =:= 0', 'x', {
      numericFallback: true
    })).toEqual({kind: 'unsupported', target: 'x', reason: 'interval-required'});
  });

  it('keeps isolated exponential and logarithmic answers exact', () => {
    const math = createMath();
    const exponential = math.solveEquation('exp(x) =:= 3', 'x', {
      numericFallback: true,
      interval: {lower: 0, upper: 2}
    }) as FiniteSolutions;
    const logarithm = math.solveEquation('log(x) =:= 2', 'x', {
      numericFallback: true,
      interval: {lower: 0, upper: 10}
    }) as FiniteSolutions;

    expect(Number(exponential.solutions[0]?.value.compile().evaluate()))
      .toBeCloseTo(Math.log(3), 12);
    expect(Number(logarithm.solutions[0]?.value.compile().evaluate()))
      .toBeCloseTo(Math.exp(2), 12);
    expect(exponential.solutions[0]?.exact).toBe(true);
    expect(logarithm.solutions[0]?.exact).toBe(true);
  });

  it('finds multiple mixed-occurrence trigonometric roots', () => {
    const math = createMath();
    const source = 'sin(x) =:= x/2';
    const result = partial(math.solveEquation(source, 'x', {
      numericFallback: true,
      interval: {lower: -2, upper: 2}
    }));

    expectRoots(values(result), [-1.895494267033981, 0, 1.895494267033981]);
    expect(result.scope).toEqual({
      domain: 'real',
      completeness: 'partial',
      interval: {lower: -2, upper: 2, includeLower: true, includeUpper: true}
    });
    expectVerified(math, source, result);
  });

  it('finds mixed trigonometric and exponential roots', () => {
    const math = createMath();
    const source = 'sin(x) + exp(x)/10 =:= 0';
    const result = partial(math.solveEquation(source, 'x', {
      numericFallback: true,
      interval: {lower: -4, upper: 1}
    }));

    expect(result.solutions.length).toBeGreaterThanOrEqual(2);
    expectVerified(math, source, result);
  });

  it('respects open and closed endpoint roots', () => {
    const math = createMath();
    const source = 'exp(x) + x =:= 1';
    const closed = math.solveEquation(source, 'x', {
      numericFallback: true,
      interval: {lower: 0, upper: 2}
    });
    const open = math.solveEquation(source, 'x', {
      numericFallback: true,
      interval: {lower: 0, upper: 2, includeLower: false}
    });

    expectRoots(values(closed), [0]);
    expect(values(open)).toEqual([]);
  });
});

describe('singularities, tangent roots, and close roots', () => {
  it('does not manufacture roots at rational or removable singularities', () => {
    const math = createMath();
    expect(math.solveEquation('1/x =:= 0', 'x', {
      numericFallback: true,
      interval: {lower: -1, upper: 1}
    }).kind).toBe('contradiction');

    const removable = math.solveEquation('sin(x)/x =:= 1', 'x', {
      numericFallback: true,
      interval: {lower: -0.1, upper: 0.1}
    });
    expect(values(removable)).toEqual([]);
  });

  it('partitions a partly invalid logarithm domain', () => {
    const math = createMath();
    const source = 'log(x) + x =:= 0';
    const result = partial(math.solveEquation(source, 'x', {
      numericFallback: true,
      interval: {lower: -2, upper: 2}
    }));

    expectRoots(values(result), [0.5671432904097838]);
    expectVerified(math, source, result);
  });

  it('never accepts a tangent pole as a root', () => {
    const math = createMath();
    const source = 'tan(x) + x =:= 0';
    const result = partial(math.solveEquation(source, 'x', {
      numericFallback: true,
      interval: {lower: -4, upper: 4}
    }));

    expect(result.solutions.every((solution) =>
      Math.abs(Math.cos(Number(solution.value.compile().evaluate()))) > 1e-6
    )).toBe(true);
    expectVerified(math, source, result);
  });

  it('detects an even-multiplicity tangent root without claiming completeness', () => {
    const math = createMath();
    const source = 'cos(x) + x^2 =:= 1';
    const result = partial(math.solveEquation(source, 'x', {
      numericFallback: true,
      interval: {lower: -2, upper: 2}
    }));

    expect(result.solutions).toHaveLength(1);
    expect(Math.abs(values(result)[0]!)).toBeLessThan(1e-7);
    expect(result.reason).toBe('numeric-search-incomplete');
    expect(result.scope?.completeness).toBe('partial');
  });

  it('separates two close exponential roots', () => {
    const math = createMath();
    const source = '(exp(x)-2)*(exp(x)-2.0001) =:= 0';
    const result = partial(math.solveEquation(source, 'x', {
      numericFallback: true,
      interval: {lower: 0.68, upper: 0.71}
    }));

    expectRoots(values(result), [Math.log(2), Math.log(2.0001)], 9);
    expectVerified(math, source, result);
  });
});

describe('numeric search diagnostics, determinism, and limits', () => {
  const source = 'exp(x) + x =:= 3';
  const options = {
    numericFallback: true as const,
    interval: {lower: -2, upper: 2},
    diagnostics: true as const
  };

  it('is deterministic and reports search accounting', () => {
    const math = createMath();
    const first = math.solveEquation(source, 'x', options);
    const second = math.solveEquation(source, 'x', options);

    expect(second).toEqual(first);
    expect(first.diagnostics?.steps.some((step) =>
      step.rule === 'bounded-numeric-search' && step.outcome === 'partial'
    )).toBe(true);
    for (const rule of [
      'numeric-evaluations',
      'numeric-invalid-evaluations',
      'numeric-subdivisions',
      'numeric-brackets',
      'numeric-rejected-candidates',
      'numeric-completeness'
    ]) {
      expect(first.diagnostics?.steps.some((step) => step.rule === rule)).toBe(true);
    }
  });

  it.each([
    [{functionEvaluations: 0}, 'function-evaluations'],
    [{intervalSubdivisions: 0}, 'interval-subdivisions'],
    [{brackets: 0}, 'brackets'],
    [{numericIterations: 0}, 'numeric-iterations'],
    [{candidates: 0}, 'candidates'],
    [{totalWork: 0}, 'total-work']
  ] as const)('returns a typed %s limit', (limits, limit) => {
    const result = createMath().solveEquation(source, 'x', {
      numericFallback: true,
      interval: {lower: -2, upper: 2},
      limits
    });

    expect(result).toEqual({kind: 'limit', target: 'x', limit});
  });

  it('contains fuzzed bounded expressions without untyped failures', () => {
    const math = createMath();
    fc.assert(fc.property(
      fc.integer({min: 1, max: 8}),
      fc.integer({min: -5, max: 5}),
      fc.constantFrom('sin', 'cos', 'exp'),
      (frequency, offset, fn) => {
        const equation = `${fn}(${frequency}*x) + x =:= ${offset}`;
        const result = math.solveEquation(equation, 'x', {
          numericFallback: true,
          interval: {lower: -2, upper: 2},
          limits: {
            functionEvaluations: 2_000,
            intervalSubdivisions: 1_000,
            numericIterations: 1_000,
            totalWork: 10_000
          }
        });
        expect([
          'finite',
          'parametric',
          'partial',
          'contradiction',
          'unsupported',
          'limit'
        ]).toContain(result.kind);
      }
    ), {seed: 20260903, numRuns: 50});
  }, 30_000);
});

describe('numeric search internal boundaries', () => {
  it('normalizes primitive and MathJS-like numeric values', () => {
    expect(numericSearchValue(2)).toBe(2);
    expect(numericSearchValue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(numericSearchValue({toNumber: () => 3})).toBe(3);
    expect(numericSearchValue({toNumber: () => Number.NaN})).toBeNull();
    expect(numericSearchValue('3')).toBeNull();
    expect(numericSearchValue(null)).toBeNull();
  });

  it('evaluates every domain-condition kind at ordinary and safe margins', () => {
    const math = createMath();
    const condition = (kind: Parameters<typeof math.symbolicKernel.condition>[0], value: string) =>
      math.symbolicKernel.condition(kind, math.parse(value));
    const ordinary = [
      ['zero', '0', true], ['zero', '1', false],
      ['nonzero', '1', true], ['nonzero', '0', false],
      ['positive', '1', true], ['positive', '0', false],
      ['nonnegative', '0', true], ['nonnegative', '-1', false],
      ['negative', '-1', true], ['negative', '0', false],
      ['nonpositive', '0', true], ['nonpositive', '1', false],
      ['defined', '1', true], ['defined', 'true', true],
      ['defined', 'missing', false]
    ] as const;
    for (const [kind, expression, expected] of ordinary) {
      expect(numericSearchConditionHolds(condition(kind, expression), {x: 0}))
        .toBe(expected);
    }

    const safe = [
      ['zero', '0', true], ['zero', '1', false],
      ['nonzero', '1', true], ['nonzero', '1e-8', false],
      ['positive', '1', true], ['positive', '0', false],
      ['nonnegative', '0', true], ['nonnegative', '-1', false],
      ['negative', '-1', true], ['negative', '0', false],
      ['nonpositive', '0', true], ['nonpositive', '1', false],
      ['defined', 'true', true], ['defined', 'missing', false]
    ] as const;
    for (const [kind, expression, expected] of safe) {
      expect(numericSearchConditionSafelyHolds(
        condition(kind, expression),
        {x: 0},
        1e-12
      )).toBe(expected);
    }
  });

  it('covers direct engine domain and preflight exits', () => {
    const math = createMath();
    const equation = math.parseEquation('sin(x) + x =:= 0');

    expect(math.numericSolve(equation, 'x')).toEqual({
      kind: 'unsupported', target: 'x', reason: 'no-rule'
    });
    expect(math.numericSolve(equation, 'x', {
      numericFallback: true,
      domain: 'complex'
    })).toEqual({kind: 'unsupported', target: 'x', reason: 'unsupported-domain'});
    expect(math.numericSolve(equation, 'x', {
      numericFallback: true,
      interval: {lower: -1, upper: 1},
      limits: {inputNodes: 0}
    })).toEqual({kind: 'limit', target: 'x', limit: 'input-nodes'});
  });

  it('handles contradictory domains and evaluation exceptions without throwing', () => {
    const math = createMath();
    const contradictory = math.numericSolve(
      math.parseEquation('sqrt(-1) + x =:= 0'),
      'x',
      {numericFallback: true, interval: {lower: -1, upper: 1}}
    );
    const undefinedFunction = math.numericSolve(
      math.parseEquation('unknownNumericFunction(x) + x =:= 0'),
      'x',
      {numericFallback: true, interval: {lower: -1, upper: 1}}
    );

    expect(contradictory.kind).toBe('contradiction');
    expect(undefinedFunction.kind).toBe('partial');
    expect((undefinedFunction as PartialResult).solutions).toEqual([]);
  });
});
