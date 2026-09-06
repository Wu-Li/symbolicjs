import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs, pattern} from '../src/index.js';

function createMath(config?: Parameters<typeof create>[1]) {
  return importsymbolicjs(create(all!, config));
}

describe('Chapter 8 branch coverage', () => {
  it('covers unmatched alternatives and standalone optional/rest patterns', () => {
    const math = createMath();
    const x = math.parse('x');

    expect(math.symbolic.match(
      x,
      pattern.alternative(
        pattern.literal(math.parse('y')),
        pattern.literal(math.parse('z'))
      )
    )).toBeNull();

    const optional = math.symbolic.match(x, pattern.optional(pattern.literal(math.parse('y'))));
    expect(optional && optional.kind !== 'limit').toBe(true);

    const rest = math.symbolic.match(x, pattern.rest('items'));
    expect(rest && rest.kind !== 'limit').toBe(true);
    if (rest && rest.kind !== 'limit') {
      expect(rest.bindings.rest.items?.map((node) => node.toString())).toEqual(['x']);
    }
  });

  it('covers ordered arity rejection paths', () => {
    const math = createMath();
    const exact = pattern.function('f', [pattern.capture('a'), pattern.capture('b')]);
    const optional = pattern.function('f', [
      pattern.capture('a'),
      pattern.optional(pattern.capture('b'))
    ]);

    expect(math.symbolic.match(math.parse('f(a)'), exact)).toBeNull();
    expect(math.symbolic.match(math.parse('f(a, b, c)'), exact)).toBeNull();
    expect(math.symbolic.match(math.parse('f(a)'), optional)).not.toBeNull();
  });

  it('covers commutative optional misses without a rest capture', () => {
    const math = createMath();
    const result = math.symbolic.match(
      math.parse('a + b'),
      pattern.operator('+', [
        pattern.capture('head'),
        pattern.optional(pattern.literal(math.parse('0'))),
        pattern.capture('tail')
      ], {associative: true, commutative: true}),
      {limits: {matchBranches: 50}}
    );

    expect(result && result.kind !== 'limit').toBe(true);
  });

  it('uses configured BigNumber sampling for inconclusive numeric evidence', () => {
    const math = createMath({number: 'BigNumber'});
    const result = math.symbolic.verifySubstitution(
      math.parse('x'),
      math.parse('abs(a)'),
      'x',
      math.parse('sqrt(a^2)'),
      {domain: 'real', mode: 'conditional'}
    );

    expect(result).toMatchObject({status: 'inconclusive', reason: 'numeric-evidence-only'});
  });

  it('compares boolean-valued samples for agreement and mismatch', () => {
    const math = createMath();
    const agreement = math.symbolic.verifySubstitution(
      math.parse('x'),
      math.parse('0 < a'),
      'x',
      math.parse('a > 0'),
      {mode: 'conditional'}
    );
    expect(agreement).toMatchObject({status: 'inconclusive', reason: 'numeric-evidence-only'});

    const mismatch = math.symbolic.verifySubstitution(
      math.parse('x'),
      math.parse('a < 0'),
      'x',
      math.parse('a > 0'),
      {mode: 'conditional'}
    );
    expect(mismatch.status).toBe('rejected');
  });
});
