import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {
  complexDistance,
  instantiateIntegerExpression,
  loadAcceptanceFixtures,
  parseAcceptanceFixtures,
  rootSetsMatch,
  scaledPolynomialResidual,
  seededIntegers
} from './support/acceptance.js';

describe('acceptance fixture validation', () => {
  it('loads the frozen baseline fixture document', () => {
    const fixtures = loadAcceptanceFixtures(
      new URL('./fixtures/baseline.json', import.meta.url)
    );
    expect(fixtures).toHaveLength(16);
    expect(Object.isFrozen(fixtures)).toBe(true);
    expect(fixtures.every((fixture) => Object.isFrozen(fixture))).toBe(true);
    expect(fixtures.every((fixture) => Object.isFrozen(fixture.provenance))).toBe(true);
  });

  it.each([
    [null, 'array'],
    [[null], 'object'],
    [[{id: '', equation: 'x =:= 1', target: 'x', expectedKind: 'finite',
      provenance: {kind: 'regression', source: 'test'}}], 'nonempty'],
    [[{id: 'a', equation: 'x =:= 1', target: 'x', expectedKind: 'mystery',
      provenance: {kind: 'regression', source: 'test'}}], 'unknown'],
    [[{id: 'a', equation: 'x =:= 1', target: 'x', expectedKind: 'finite',
      domain: 'integer', provenance: {kind: 'regression', source: 'test'}}], 'domain'],
    [[{id: 'a', equation: 'x =:= 1', target: 'x', expectedKind: 'finite',
      tolerance: Number.NaN, provenance: {kind: 'regression', source: 'test'}}], 'tolerance'],
    [[{id: 'a', equation: 'x =:= 1', target: 'x', expectedKind: 'finite',
      interval: {lower: 2, upper: 1}, provenance: {kind: 'regression', source: 'test'}}],
    'lower'],
    [[{id: 'a', equation: 'x =:= 1', target: 'x', expectedKind: 'finite',
      provenance: {kind: 'unknown', source: 'test'}}], 'provenance']
  ] as const)('rejects malformed fixtures %#', (document, message) => {
    expect(() => parseAcceptanceFixtures(document)).toThrow(message);
  });

  it('rejects duplicate fixture ids', () => {
    const fixture = {
      id: 'duplicate',
      equation: 'x =:= 1',
      target: 'x',
      expectedKind: 'finite',
      provenance: {kind: 'independent', source: 'test'}
    };
    expect(() => parseAcceptanceFixtures([fixture, fixture])).toThrow('Duplicate');
  });
});

describe('acceptance numeric helpers', () => {
  it('compares unordered real and complex root sets', () => {
    expect(rootSetsMatch([2, -1], [-1, 2], 1e-12)).toBe(true);
    expect(rootSetsMatch(
      [{re: 0, im: 1}, {re: 0, im: -1}],
      [{re: 0, im: -1}, {re: 0, im: 1}],
      1e-12
    )).toBe(true);
    expect(complexDistance({re: 3, im: 4}, 0)).toBe(5);
  });

  it('preserves multiplicity only when requested', () => {
    expect(rootSetsMatch([1, 1], [1], 1e-12)).toBe(false);
    expect(rootSetsMatch([1, 1], [1], 1e-12, false)).toBe(true);
    expect(rootSetsMatch([1, 2], [1, 3], 1e-12)).toBe(false);
    expect(() => rootSetsMatch([], [], 0)).toThrow('positive');
  });

  it('measures a scale-aware polynomial residual', () => {
    expect(scaledPolynomialResidual([1, -3, 2], 1)).toBe(0);
    expect(scaledPolynomialResidual([1e100, -3e100, 2e100], 2)).toBeLessThan(1e-15);
    expect(scaledPolynomialResidual([1, -3, 2], 1.1)).toBeGreaterThan(0);
    expect(scaledPolynomialResidual([1, Number.NaN], 1)).toBe(Infinity);
    expect(scaledPolynomialResidual([], 1)).toBe(Infinity);
  });

  it('generates deterministic seeded integer sequences', () => {
    expect(seededIntegers(20260903, 8)).toEqual(seededIntegers(20260903, 8));
    expect(seededIntegers(20260903, 8)).not.toEqual(seededIntegers(20260904, 8));
    expect(seededIntegers(1, 0)).toEqual([]);
    expect(() => seededIntegers(1, -1)).toThrow('nonnegative');
  });

  it('instantiates integer-parameter expressions safely', () => {
    const math = create(all!);
    const expression = math.parse('2*pi*k');
    expect(instantiateIntegerExpression(expression, ['k'], {k: -2})).toBeCloseTo(
      -4 * Math.PI
    );
    expect(() => instantiateIntegerExpression(expression, ['k'], {k: 1.5})).toThrow(
      'safe integer'
    );
    expect(() => instantiateIntegerExpression(expression, ['k'], {k: 1, extra: 2}))
      .toThrow('do not match');
  });
});
