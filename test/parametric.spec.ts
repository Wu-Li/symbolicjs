import {all, create} from 'mathjs';
import type {MathNode} from 'mathjs';
import fc from 'fast-check';
import {describe, expect, it} from 'vitest';
import {
  allocateIntegerParameter,
  importsymbolicjs
} from '../src/index.js';
import {parametricResult} from '../src/solve-types.js';
import type {
  FiniteSolutions,
  ParametricFamily,
  ParametricSolutions,
  PartialResult,
  SolveResult,
  symbolicjsInstance
} from '../src/index.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

function family(
  math: symbolicjsInstance,
  source: string,
  parameter = 'k'
): ParametricFamily {
  return Object.freeze({
    value: math.parse(source),
    parameters: Object.freeze([{name: parameter, domain: 'integer' as const}]),
    conditions: Object.freeze([]),
    exact: true,
    verification: Object.freeze({
      status: 'proven' as const,
      evidence: Object.freeze({method: 'construction' as const})
    })
  });
}

function values(result: SolveResult, scope: Record<string, unknown> = {}): number[] {
  expect(result.kind).toBe('finite');
  return (result as FiniteSolutions).solutions.map((solution) =>
    Number(solution.value.compile().evaluate(scope))
  );
}

describe('integer parameter allocation and family canonicalization', () => {
  it('allocates a deterministic uncaptured name', () => {
    expect(allocateIntegerParameter([])).toEqual({name: '_k0', domain: 'integer'});
    expect(allocateIntegerParameter(['k', '_k0', '_k1'])).toEqual({
      name: '_k2',
      domain: 'integer'
    });
    expect(Object.isFrozen(allocateIntegerParameter([]))).toBe(true);
    expect(() => allocateIntegerParameter([], -1)).toThrow('nonnegative');
  });

  it('alpha-normalizes and deduplicates equivalent families', () => {
    const math = createMath();
    const normalized = math.canonicalizeParametricFamilies([
      family(math, 'a + 2*pi*k', 'k'),
      family(math, 'a + 2*pi*n', 'n'),
      family(math, 'a + pi*n', 'n')
    ], ['a']);

    expect(normalized).toHaveLength(2);
    expect(normalized.every((value) => value.parameters[0]?.name === '_k0'))
      .toBe(true);
    expect(normalized.map((value) => value.value.toString()).join('|')).toContain('pi');
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(normalized.every(Object.isFrozen)).toBe(true);
  });

  it('avoids symbols already used by the equation', () => {
    const math = createMath();
    const normalized = math.canonicalizeParametricFamilies(
      [family(math, 'k + _k0', 'k')],
      ['_k0']
    );

    expect(normalized[0]?.parameters[0]?.name).toBe('_k1');
    expect(normalized[0]?.value.toString()).toContain('_k1');
    expect(normalized[0]?.value.toString()).toContain('_k0');
  });

  it('rejects duplicate and malformed parameters', () => {
    const math = createMath();
    const valid = family(math, 'k', 'k');

    expect(() => math.canonicalizeParametricFamilies([{
      ...valid,
      parameters: [valid.parameters[0]!, valid.parameters[0]!]
    }])).toThrow('Duplicate');
    expect(() => math.canonicalizeParametricFamilies([{
      ...valid,
      parameters: [{name: '', domain: 'integer'}]
    }])).toThrow('valid integer');
    expect(() => math.canonicalizeParametricFamilies([{
      ...valid,
      exact: false
    } as never])).toThrow('valid exact');
  });

  it('renames multiple parameters and parameterized conditions', () => {
    const math = createMath();
    const normalized = math.canonicalizeParametricFamilies([{
      ...family(math, 'k+n'),
      parameters: [
        {name: 'k', domain: 'integer'},
        {name: 'n', domain: 'integer'}
      ],
      conditions: [{kind: 'nonzero', expression: math.parse('k-n')}]
    }]);

    expect(normalized[0]?.parameters.map((parameter) => parameter.name))
      .toEqual(['_k0', '_k1']);
    expect(normalized[0]?.conditions[0]?.expression.toString()).toContain('_k');
  });
});

describe('family instantiation', () => {
  it.each([-3, 0, 4])('instantiates integer parameter %s', (integer) => {
    const math = createMath();
    const value = math.instantiateFamily(family(math, '1 + 2*k'), {k: integer});

    expect(value.compile().evaluate()).toBe(1 + 2 * integer);
  });

  it('does not mutate the source family', () => {
    const math = createMath();
    const source = family(math, '1 + 2*k');
    const before = source.value.toString();

    math.instantiateFamily(source, {k: 2});
    expect(source.value.toString()).toBe(before);
  });

  it.each([
    [{}, 'match'],
    [{k: 1, extra: 2}, 'match'],
    [{k: 1.5}, 'safe integer'],
    [{k: Number.MAX_SAFE_INTEGER + 1}, 'safe integer']
  ] as const)('rejects invalid assignments %#', (assignments, message) => {
    const math = createMath();

    expect(() => math.instantiateFamily(family(math, 'k'), assignments))
      .toThrow(message);
  });

  it('rejects non-object assignments and invalid verification inputs', () => {
    const math = createMath();
    const source = family(math, 'k');
    const multi = {...source, parameters: [
      {name: 'k', domain: 'integer' as const},
      {name: 'n', domain: 'integer' as const}
    ]};

    expect(() => math.instantiateFamily(source, null as never)).toThrow('object');
    expect(() => math.verifyParametricFamily(math.parse('x') as never, 'x', source))
      .toThrow('EqualityNode');
    expect(math.verifyParametricFamily(
      math.parseEquation('x =:= 0'),
      'x',
      multi
    ).reason).toBe('sample-verification-requires-one-parameter');
  });

  it('uses finite samples only to falsify, never to prove a family', () => {
    const math = createMath();
    const equation = math.parseEquation('sin(x) =:= 0');
    const valid = family(math, '2*pi*k');
    const invalid = family(math, 'pi/2 + 2*pi*k');

    expect(math.verifyParametricFamily(equation, 'x', valid).status)
      .toBe('inconclusive');
    expect(math.verifyParametricFamily(equation, 'x', invalid).status)
      .toBe('rejected');
    expect(() => math.verifyParametricFamily(equation, 'x', valid, [0.5]))
      .toThrow('safe integers');
  });
});

describe('interval materialization', () => {
  it('materializes positive and negative affine periods in sorted order', () => {
    const math = createMath();
    const positive = parametricResult('x', [family(math, '1 + 2*k')]);
    const negative = parametricResult('x', [family(math, '1 - 2*k')]);

    expect(values(math.materializeSolutions(positive, {lower: -3, upper: 5})))
      .toEqual([-3, -1, 1, 3, 5]);
    expect(values(math.materializeSolutions(negative, {lower: -3, upper: 5})))
      .toEqual([-3, -1, 1, 3, 5]);
  });

  it('honors open endpoints, point intervals, and empty intersections', () => {
    const math = createMath();
    const result = parametricResult('x', [family(math, '1 + 2*k')]);

    expect(values(math.materializeSolutions(result, {
      lower: -3,
      upper: 5,
      includeLower: false,
      includeUpper: false
    }))).toEqual([-1, 1, 3]);
    expect(values(math.materializeSolutions(result, {lower: 1, upper: 1})))
      .toEqual([1]);
    expect(math.materializeSolutions(result, {lower: 2, upper: 2}).kind)
      .toBe('contradiction');
  });

  it('uses a coefficient scope without substituting it into returned nodes', () => {
    const math = createMath();
    const result = parametricResult('x', [family(math, 'a + 2*k')]);
    const materialized = math.materializeSolutions(
      result,
      {lower: -1, upper: 3},
      {a: 1}
    );

    expect(values(materialized, {a: 1})).toEqual([-1, 1, 3]);
    expect((materialized as FiniteSolutions).solutions[0]?.value.toString())
      .toContain('a');
  });

  it('materializes constant families and parameterized conditions', () => {
    const math = createMath();
    const constant = parametricResult('x', [{
      ...family(math, '2'),
      conditions: [{kind: 'nonzero', expression: math.parse('k + 1')}]
    }]);
    const materialized = math.materializeSolutions(constant, {lower: 0, upper: 3});

    expect(values(materialized)).toEqual([2]);
    expect((materialized as FiniteSolutions).solutions[0]?.conditions).toEqual([]);
  });

  it('deduplicates overlapping families and freezes the complete interval scope', () => {
    const math = createMath();
    const result = parametricResult('x', [
      family(math, '2*k'),
      family(math, '2*n', 'n')
    ]);
    const materialized = math.materializeSolutions(result, {lower: -2, upper: 2});

    expect(values(materialized)).toEqual([-2, 0, 2]);
    expect(materialized.scope?.completeness).toBe('complete-in-interval');
    expect(Object.isFrozen(materialized)).toBe(true);
    expect(Object.isFrozen(materialized.scope)).toBe(true);
    expect(Object.isFrozen(materialized.scope?.interval)).toBe(true);
  });

  it('retains partial classification and the original remainder', () => {
    const math = createMath();
    const remainder = math.parseEquation('sin(x) + x =:= 0');
    const partial: PartialResult & {families: readonly ParametricFamily[]} =
      Object.freeze({
        kind: 'partial',
        target: 'x',
        solutions: Object.freeze([]),
        families: Object.freeze([family(math, '2*pi*k')]),
        remainder,
        reason: 'unsupported-trig-form'
      });
    const materialized = math.materializeSolutions(partial, {
      lower: -Math.PI,
      upper: Math.PI
    });

    expect(materialized.kind).toBe('partial');
    expect(materialized.scope?.completeness).toBe('partial');
    expect((materialized as PartialResult).remainder).toBe(remainder);
  });

  it('rejects non-affine and multi-parameter families', () => {
    const math = createMath();
    const nonlinear = parametricResult('x', [family(math, 'k^2')]);
    const multi = parametricResult('x', [{
      ...family(math, 'k+n'),
      parameters: [{name: 'k', domain: 'integer'}, {name: 'n', domain: 'integer'}]
    }]);

    expect(math.materializeSolutions(nonlinear, {lower: -2, upper: 2})).toEqual({
      kind: 'unsupported', target: 'x', reason: 'unsupported-structure'
    });
    expect(math.materializeSolutions(multi, {lower: -2, upper: 2})).toEqual({
      kind: 'unsupported', target: 'x', reason: 'unsupported-structure'
    });
  });

  it('rejects unresolvable coefficients and invalid public inputs', () => {
    const math = createMath();
    const unresolved = parametricResult('x', [family(math, 'a + 2*k')]);

    expect(math.materializeSolutions(unresolved, {lower: -2, upper: 2})).toEqual({
      kind: 'unsupported', target: 'x', reason: 'unsupported-structure'
    });
    expect(() => math.materializeSolutions({kind: 'finite'} as never, {
      lower: -1, upper: 1
    })).toThrow('parametric');
    expect(() => math.materializeSolutions(unresolved, {lower: -1, upper: 1}, [] as never))
      .toThrow('scope');
  });

  it('limits materialization when derived integer bounds are unsafe', () => {
    const math = createMath();
    const result = parametricResult('x', [family(math, '1e-10*k')]);

    expect(math.materializeSolutions(result, {lower: -1e308, upper: 1e308})).toEqual({
      kind: 'limit', target: 'x', limit: 'candidates'
    });
  });

  it('supports configured BigNumber evaluation', () => {
    const math = importsymbolicjs(create(all!, {number: 'BigNumber'}));
    const result = parametricResult('x', [family(math, '1 + 2*k')]);

    expect(values(math.materializeSolutions(result, {lower: -1, upper: 3})))
      .toEqual([-1, 1, 3]);
  });

  it('enforces family, candidate, and total-work limits before allocation', () => {
    const math = createMath();
    const result = parametricResult('x', [family(math, 'k')]);

    expect(math.materializeSolutions(result, {lower: 0, upper: 1}, {}, {
      limits: {parametricFamilies: 0}
    })).toEqual({kind: 'limit', target: 'x', limit: 'parametric-families'});
    expect(math.materializeSolutions(result, {lower: -10000, upper: 10000}, {}, {
      limits: {candidates: 10}
    })).toEqual({kind: 'limit', target: 'x', limit: 'candidates'});
    expect(math.materializeSolutions(result, {lower: 0, upper: 1}, {}, {
      limits: {totalWork: 0}
    })).toEqual({kind: 'limit', target: 'x', limit: 'total-work'});
  });

  it('matches bounded brute-force enumeration for generated affine families', () => {
    const math = createMath();
    fc.assert(fc.property(
      fc.integer({min: -10, max: 10}),
      fc.integer({min: -6, max: 6}).filter((value) => value !== 0),
      fc.integer({min: -20, max: 0}),
      fc.integer({min: 0, max: 20}),
      (offset, slope, lower, upper) => {
        const result: ParametricSolutions = parametricResult(
          'x',
          [family(math, `${offset} + (${slope})*k`)]
        );
        const materialized = math.materializeSolutions(
          result,
          {lower, upper},
          {},
          {limits: {candidates: 128}}
        );
        const expected = Array.from({length: 201}, (_, index) => index - 100)
          .map((integer) => offset + slope * integer)
          .filter((value) => value >= lower && value <= upper)
          .filter((value, index, allValues) => allValues.indexOf(value) === index)
          .sort((left, right) => left - right);
        if (expected.length === 0) {
          expect(materialized.kind).toBe('contradiction');
        } else {
          expect(values(materialized)).toEqual(expected);
        }
      }
    ), {seed: 20260903, numRuns: 100});
  });
});
