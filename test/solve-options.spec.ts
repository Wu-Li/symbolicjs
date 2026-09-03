import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {
  createSearchScope,
  importsymbolicjs,
  normalizeRealInterval
} from '../src/index.js';
import {parametricResult} from '../src/solve-types.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

describe('solve domains and intervals', () => {
  it('preserves the existing default result shape', () => {
    const result = createMath().solveEquation('x + 1 =:= 2', 'x');

    expect(result.kind).toBe('finite');
    expect(result).not.toHaveProperty('scope');
    expect(result).not.toHaveProperty('domain');
  });

  it.each([
    [null, 'object'],
    [{domain: 'integer'}, 'domain'],
    [{numericFallback: 1}, 'numericFallback'],
    [{diagnostics: 'yes'}, 'diagnostics'],
    [{limits: []}, 'limits'],
    [{tolerance: 0}, 'tolerance'],
    [{tolerance: Number.POSITIVE_INFINITY}, 'tolerance'],
    [{interval: {lower: Number.NEGATIVE_INFINITY, upper: 1}}, 'finite'],
    [{interval: {lower: 2, upper: 1}}, 'lower'],
    [{interval: {lower: 1, upper: 1, includeLower: false}}, 'empty'],
    [{interval: {lower: 0, upper: 1, includeUpper: 1}}, 'boolean']
  ] as const)('rejects invalid options %#', (options, message) => {
    const math = createMath();

    expect(() => math.solveEquation('x =:= 1', 'x', options as never))
      .toThrow(message);
  });

  it('classifies a complex interval as an unsupported search domain', () => {
    const math = createMath();

    expect(math.solveEquation('x^2 + 1 =:= 0', 'x', {
      domain: 'complex',
      interval: {lower: 0, upper: 1}
    })).toEqual({kind: 'unsupported', target: 'x', reason: 'unsupported-domain'});
  });

  it('validates options even when solve-for-all has no targets', () => {
    const math = createMath();

    expect(() => math.solveEquationForAll('1 =:= 1', {domain: 'bad'} as never))
      .toThrow('domain');
  });

  it('accepts real intervals and explicit fallback control without using them yet', () => {
    const result = createMath().solveEquation('x =:= 1', 'x', {
      domain: 'real',
      interval: {lower: -2, upper: 2, includeLower: false},
      numericFallback: false
    });

    expect(result.kind).toBe('finite');
  });
});

describe('normalized public metadata', () => {
  it('normalizes endpoint defaults and negative zero', () => {
    const interval = normalizeRealInterval({lower: -0, upper: 2});

    expect(interval).toEqual({
      lower: 0,
      upper: 2,
      includeLower: true,
      includeUpper: true
    });
    expect(Object.is(interval.lower, -0)).toBe(false);
    expect(Object.isFrozen(interval)).toBe(true);
  });

  it('constructs validated frozen search scopes', () => {
    const scope = createSearchScope('real', 'complete-in-interval', {
      lower: 0,
      upper: 1,
      includeUpper: false
    });

    expect(scope).toEqual({
      domain: 'real',
      completeness: 'complete-in-interval',
      interval: {lower: 0, upper: 1, includeLower: true, includeUpper: false}
    });
    expect(Object.isFrozen(scope)).toBe(true);
    expect(Object.isFrozen(scope.interval)).toBe(true);
    expect(() => createSearchScope('complex', 'complete-in-interval', {
      lower: 0,
      upper: 1
    })).toThrow('real domain');
    expect(() => createSearchScope('real', 'complete-in-interval')).toThrow('interval');
    expect(() => createSearchScope('integer' as never, 'complete')).toThrow('domain');
    expect(() => createSearchScope('real', 'unknown' as never)).toThrow('completeness');
    expect(() => normalizeRealInterval(null as never)).toThrow('object');
  });

  it('deep-freezes the reserved parametric result shape', () => {
    const math = createMath();
    const result = parametricResult('x', [{
      value: math.parse('2*pi*_k0'),
      parameters: [{name: '_k0', domain: 'integer'}],
      conditions: [{kind: 'nonzero', expression: math.parse('a')}],
      exact: true,
      verification: {
        status: 'proven',
        evidence: {method: 'construction', bracket: [0, 1]}
      }
    }]);

    expect(result.kind).toBe('parametric');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.families)).toBe(true);
    expect(Object.isFrozen(result.families[0])).toBe(true);
    expect(Object.isFrozen(result.families[0]?.parameters)).toBe(true);
    expect(Object.isFrozen(result.families[0]?.parameters[0])).toBe(true);
    expect(Object.isFrozen(result.families[0]?.conditions)).toBe(true);
    expect(Object.isFrozen(result.families[0]?.verification)).toBe(true);
    expect(Object.isFrozen(result.families[0]?.verification.evidence)).toBe(true);
    expect(Object.isFrozen(result.families[0]?.verification.evidence?.bracket)).toBe(true);
  });
});
