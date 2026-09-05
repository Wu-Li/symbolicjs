import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

describe('expression equivalence', () => {
  it('proves raw structural identity', () => {
    const math = createMath();
    const x = math.parse('x + 1');
    const result = math.symbolic.equivalent(x, x);

    expect(result.truth).toBe('proven');
    expect(result.evidence).toEqual([{kind: 'structural-identity'}]);
  });

  it('proves canonical scalar identity', () => {
    const math = createMath();
    const result = math.symbolic.equivalent(
      math.parse('x + 0'),
      math.parse('x'),
      {mode: 'conditional'}
    );

    expect(result.truth).toBe('proven');
    expect(result.evidence.some((entry) => entry.kind === 'canonical-identity')).toBe(true);
  });

  it('proves polynomial coefficient equality', () => {
    const math = createMath();
    const result = math.symbolic.equivalent(
      math.parse('(x + 1) * (x + 1)'),
      math.parse('x^2 + 2*x + 1'),
      {generators: ['x'], domain: 'real', mode: 'conditional'}
    );

    expect(result.truth).toBe('proven');
    expect(result.evidence.some((entry) => entry.kind === 'polynomial-coefficients')).toBe(true);
  });

  it('proves rational equality while preserving denominator requirements', () => {
    const math = createMath();
    const result = math.symbolic.equivalent(
      math.parse('(x^2 - 1) / (x - 1)'),
      math.parse('x + 1'),
      {generators: ['x'], domain: 'real', mode: 'conditional'}
    );

    expect(result.truth).toBe('proven');
    expect(result.requirements.length).toBeGreaterThan(0);
  });

  it('does not prove domain-sensitive identities without sufficient assumptions', () => {
    const math = createMath();
    const result = math.symbolic.equivalent(
      math.parse('sqrt(x^2)'),
      math.parse('x'),
      {domain: 'real', mode: 'strict'}
    );

    expect(result.truth).toBe('unknown');
  });
});
