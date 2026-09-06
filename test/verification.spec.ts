import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

describe('shared substitution verification', () => {
  it('proves exact substitutions symbolically', () => {
    const math = createMath();
    const result = math.symbolic.verifySubstitution(
      math.parse('x + 1'),
      math.parse('3'),
      'x',
      math.parse('2'),
      {domain: 'real', mode: 'conditional'}
    );

    expect(result.status).toBe('proven');
    expect(result.evidence.some((entry) => entry.kind === 'equivalence')).toBe(true);
  });

  it('rejects constant numeric mismatches', () => {
    const math = createMath();
    const result = math.symbolic.verifySubstitution(
      math.parse('x + 1'),
      math.parse('3'),
      'x',
      math.parse('3'),
      {domain: 'real', mode: 'conditional'}
    );

    expect(result).toMatchObject({status: 'rejected', reason: 'numeric-mismatch'});
  });

  it('keeps sampled agreement inconclusive', () => {
    const math = createMath();
    const result = math.symbolic.verifySubstitution(
      math.parse('x'),
      math.parse('abs(a)'),
      'x',
      math.parse('sqrt(a^2)'),
      {domain: 'real', mode: 'conditional'}
    );

    expect(result).toMatchObject({status: 'inconclusive', reason: 'numeric-evidence-only'});
  });

  it('uses caller-supplied samples for numeric evidence', () => {
    const math = createMath();
    const result = math.symbolic.verifySubstitution(
      math.parse('x'),
      math.parse('abs(a)'),
      'x',
      math.parse('sqrt(a^2)'),
      {domain: 'real', mode: 'conditional', samples: [-2, 4]}
    );

    expect(result).toMatchObject({status: 'inconclusive', reason: 'numeric-evidence-only'});
  });

  it('uses samples only to disprove parameterized false candidates', () => {
    const math = createMath();
    const result = math.symbolic.verifySubstitution(
      math.parse('x'),
      math.parse('a + 1'),
      'x',
      math.parse('a + 2'),
      {domain: 'real', mode: 'conditional'}
    );

    expect(result.status).toBe('rejected');
  });

  it('preserves definedness requirements', () => {
    const math = createMath();
    const result = math.symbolic.verifySubstitution(
      math.parse('1 / x'),
      math.parse('1'),
      'x',
      math.parse('y'),
      {domain: 'real', mode: 'conditional'}
    );

    expect(result.requirements.some((requirement) =>
      requirement.kind === 'property' && requirement.property === 'nonzero'
    )).toBe(true);
  });

  it('reports undefined constant candidates without treating them as mismatches', () => {
    const math = createMath();
    const result = math.symbolic.verifySubstitution(
      math.parse('x'),
      math.parse('missingFunction(1)'),
      'x',
      math.parse('1'),
      {domain: 'real', mode: 'conditional'}
    );

    expect(result).toMatchObject({status: 'rejected', reason: 'undefined-candidate'});
    expect(result.evidence).toEqual([]);
  });

  it('reports no valid samples when every parameterized evaluation is undefined', () => {
    const math = createMath();
    const result = math.symbolic.verifySubstitution(
      math.parse('x'),
      math.parse('missingFunction(a)'),
      'x',
      math.parse('a'),
      {domain: 'real', mode: 'conditional'}
    );

    expect(result).toMatchObject({status: 'inconclusive', reason: 'no-valid-samples'});
    expect(result.evidence).toEqual([]);
  });

  it('accepts configured BigNumber scalar evaluations', () => {
    const math = importsymbolicjs(create(all!, {number: 'BigNumber'}));
    const result = math.symbolic.verifySubstitution(
      math.parse('x'),
      math.parse('1 / 3'),
      'x',
      math.parse('1 / 3'),
      {domain: 'real', mode: 'conditional'}
    );

    expect(result.status).toBe('proven');
  });

  it('handles boolean-valued constant verification', () => {
    const math = createMath();
    const result = math.symbolic.verifySubstitution(
      math.parse('x'),
      math.parse('2 < 3'),
      'x',
      math.parse('true'),
      {mode: 'conditional'}
    );

    expect(result.status).toBe('proven');
  });

  it('rejects mixed boolean and numeric constants', () => {
    const math = createMath();
    const result = math.symbolic.verifySubstitution(
      math.parse('x'),
      math.parse('1'),
      'x',
      math.parse('true'),
      {mode: 'conditional'}
    );

    expect(result.status).toBe('rejected');
  });

  it('compares finite complex scalar values', () => {
    const math = createMath();
    const result = math.symbolic.verifySubstitution(
      math.parse('x'),
      math.parse('2 + 3i'),
      'x',
      math.parse('2 + 4i'),
      {domain: 'complex', mode: 'conditional'}
    );

    expect(result.status).toBe('rejected');
  });

  it('rejects invalid tolerance', () => {
    const math = createMath();
    expect(() => math.symbolic.verifySubstitution(
      math.parse('x'),
      math.parse('1'),
      'x',
      math.parse('1'),
      {tolerance: 0}
    )).toThrow(RangeError);
  });
});
