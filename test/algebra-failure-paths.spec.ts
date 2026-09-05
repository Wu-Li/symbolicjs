import {all, create} from 'mathjs';
import type {MathNode} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import {assume} from '../src/core/assumptions.js';
import {
  algebraLimit,
  compareExponentVectors,
  isAlgebraFailure,
  notRepresentable,
  totalDegree,
  viewSuccess
} from '../src/algebra/internal.js';

function createMath(config?: Parameters<typeof create>[1]) {
  return importsymbolicjs(config === undefined
    ? create(all!)
    : create(all!, config));
}

function scalarAssumptions(
  math: ReturnType<typeof createMath>,
  ...nodes: readonly MathNode[]
) {
  return nodes.map((node) => assume(math.symbolic.predicates.scalar(node)));
}

describe('algebra facade failure and option paths', () => {
  it('propagates operation options and rejects duplicate generators', () => {
    const math = createMath();
    const x = math.parse('x');
    const analyzed = math.symbolic.algebra.analyze(x, {
      domain: 'real',
      limits: {steps: 3},
      diagnostics: true
    });

    expect(analyzed.kind).toBe('analysis');
    expect(math.symbolic.algebra.affine(math.parse('x^2'), {
      generator: 'x', domain: 'real', mode: 'conditional'
    })).toMatchObject({kind: 'not-representable', reason: 'nonlinear-product'});
    expect(math.symbolic.algebra.polynomial(x, {
      generators: ['x', 'x']
    })).toMatchObject({kind: 'not-representable', reason: 'duplicate-generator'});
    expect(math.symbolic.algebra.rational(x, {
      generators: ['x', 'x']
    })).toMatchObject({kind: 'not-representable', reason: 'duplicate-generator'});
    expect(math.symbolic.canonicalize(x, {
      profile: 'polynomial', generators: ['x', 'x'], mode: 'conditional'
    }).complete).toBe(false);
  });

  it('rejects unproved scalar operations in strict mode at every view boundary', () => {
    const math = createMath();

    expect(math.symbolic.algebra.product(math.parse('x*y'), {mode: 'strict'}))
      .toMatchObject({kind: 'not-representable', reason: 'scalar-unproven'});
    expect(math.symbolic.algebra.power(math.parse('x^2'), {mode: 'strict'}))
      .toMatchObject({kind: 'not-representable', reason: 'scalar-unproven'});
    expect(math.symbolic.algebra.linear(math.parse('x'), {
      basis: ['x'], mode: 'strict'
    })).toMatchObject({kind: 'not-representable', reason: 'scalar-unproven'});
    expect(math.symbolic.algebra.polynomial(math.parse('x'), {
      generators: ['x'], mode: 'strict'
    })).toMatchObject({kind: 'not-representable', reason: 'scalar-unproven'});
    expect(math.symbolic.algebra.rational(math.parse('x'), {
      generators: ['x'], mode: 'strict'
    })).toMatchObject({kind: 'not-representable', reason: 'scalar-unproven'});
  });

  it('validates expression nodes after valid generator options are supplied', () => {
    const math = createMath();

    expect(() => math.symbolic.algebra.affine(null as never, {
      generator: 'x'
    })).toThrow(TypeError);
    expect(() => math.symbolic.algebra.linear(null as never, {
      basis: ['x']
    })).toThrow(TypeError);
    expect(() => math.symbolic.algebra.polynomial(null as never, {
      generators: ['x']
    })).toThrow(TypeError);
    expect(() => math.symbolic.algebra.rational(null as never, {
      generators: ['x']
    })).toThrow(TypeError);
  });
});

describe('algebra traversal and rebuild limits', () => {
  it('propagates traversal limits through linear, polynomial, and rational parsing', () => {
    const math = createMath();
    const options = {
      domain: 'real' as const,
      mode: 'conditional' as const,
      algebraLimits: {maximumNodes: 1}
    };

    expect(math.symbolic.algebra.linear(math.parse('x + y'), {
      ...options, basis: ['x']
    })).toMatchObject({kind: 'limit', limit: 'algebraNodes'});
    expect(math.symbolic.algebra.polynomial(math.parse('x + y'), {
      ...options, generators: ['x']
    })).toMatchObject({kind: 'limit', limit: 'algebraNodes'});
    expect(math.symbolic.algebra.rational(math.parse('1/x + 1'), {
      ...options, generators: ['x']
    })).toMatchObject({kind: 'limit', limit: 'algebraNodes'});
  });

  it('propagates canonical rebuild limits from every composite view', () => {
    const math = createMath();
    const options = {
      domain: 'real' as const,
      mode: 'conditional' as const,
      algebraLimits: {maximumRebuildNodes: 1}
    };

    expect(math.symbolic.algebra.sum(math.parse('x + y + z'), options))
      .toMatchObject({kind: 'limit', limit: 'canonicalNodes'});
    expect(math.symbolic.algebra.product(math.parse('x*y*z'), options))
      .toMatchObject({kind: 'limit', limit: 'canonicalNodes'});
    expect(math.symbolic.algebra.linear(math.parse('2*x + 3'), {
      ...options, basis: ['x']
    })).toMatchObject({kind: 'limit', limit: 'canonicalNodes'});
    expect(math.symbolic.algebra.polynomial(math.parse('x^2 + x + 1'), {
      ...options, generators: ['x']
    })).toMatchObject({kind: 'limit', limit: 'canonicalNodes'});
    expect(math.symbolic.algebra.rational(math.parse('(x + 1)/(x - 1)'), {
      ...options, generators: ['x']
    })).toMatchObject({kind: 'limit', limit: 'canonicalNodes'});
  });

  it('enforces degree, monomial, and convolution work independently', () => {
    const math = createMath();
    const common = {domain: 'real' as const, mode: 'conditional' as const};

    expect(math.symbolic.algebra.polynomial(math.parse('(x + 1)^3'), {
      ...common, generators: ['x'], algebraLimits: {maximumDegree: 2}
    })).toMatchObject({kind: 'limit', limit: 'algebraDegree'});
    expect(math.symbolic.algebra.polynomial(math.parse('x + y'), {
      ...common, generators: ['x', 'y'], algebraLimits: {maximumMonomials: 1}
    })).toMatchObject({kind: 'limit', limit: 'algebraMonomials'});
    expect(math.symbolic.algebra.polynomial(math.parse('(x + 1)^2'), {
      ...common, generators: ['x'], algebraLimits: {maximumConvolutions: 0}
    })).toMatchObject({kind: 'limit', limit: 'algebraConvolutions'});
    expect(math.symbolic.algebra.rational(math.parse('1/x + 1/(x + 1)'), {
      ...common, generators: ['x'], algebraLimits: {maximumConvolutions: 0}
    })).toMatchObject({kind: 'limit', limit: 'algebraConvolutions'});
  });
});

describe('linear parsing failure propagation', () => {
  it('returns the failing side of sums, products, division, unary minus, and operators', () => {
    const math = createMath();
    const options = {basis: ['x'], domain: 'real' as const, mode: 'conditional' as const};

    for (const source of [
      'sin(x) + x',
      'x + sin(x)',
      'sin(x) * x',
      'x * sin(x)',
      'sin(x) / a',
      '-sin(x)',
      'x!'
    ]) {
      expect(math.symbolic.algebra.linear(math.parse(source), options), source)
        .toMatchObject({kind: 'not-representable', reason: 'unsupported-node'});
    }
  });

  it('distinguishes an unproved denominator from a disproved denominator', () => {
    const math = createMath();
    const x = math.parse('x');
    const a = math.parse('a');
    const source = math.parse('x/a');
    const base = scalarAssumptions(math, x, a, source);

    expect(math.symbolic.algebra.linear(source, {
      basis: ['x'], mode: 'strict', assumptions: base
    })).toMatchObject({kind: 'not-representable', reason: 'nonzero-unproven'});
    expect(math.symbolic.algebra.linear(source, {
      basis: ['x'], mode: 'strict',
      assumptions: [...base, assume(math.symbolic.predicates.zero(a))]
    })).toMatchObject({kind: 'not-representable', reason: 'zero-denominator'});
  });
});

describe('polynomial parsing failure propagation', () => {
  it('handles unary plus and rejects unsupported children on either side', () => {
    const math = createMath();
    const options = {generators: ['x'], domain: 'real' as const, mode: 'conditional' as const};

    expect(math.symbolic.algebra.polynomial(math.parse('+(x)'), options).kind)
      .toBe('view');
    for (const source of [
      'x!',
      'sin(x) + x',
      'x + sin(x)',
      'sin(x) * x',
      'x * sin(x)',
      'sin(x) / a',
      'sin(x)^2'
    ]) {
      expect(math.symbolic.algebra.polynomial(math.parse(source), options), source)
        .toMatchObject({kind: 'not-representable'});
    }
  });

  it('classifies dependent, unresolved, fractional, and negative exponents', () => {
    const math = createMath();
    const options = {generators: ['x'], domain: 'real' as const, mode: 'conditional' as const};

    expect(math.symbolic.algebra.polynomial(math.parse('x^x'), options))
      .toMatchObject({kind: 'not-representable', reason: 'nonconstant-exponent'});
    expect(math.symbolic.algebra.polynomial(math.parse('x^a'), options))
      .toMatchObject({kind: 'not-representable', reason: 'nonconstant-exponent'});
    expect(math.symbolic.algebra.polynomial(math.parse('x^0.5'), options))
      .toMatchObject({kind: 'not-representable', reason: 'nonintegral-exponent'});
    expect(math.symbolic.algebra.polynomial(math.parse('x^-1'), options))
      .toMatchObject({kind: 'not-representable', reason: 'negative-exponent'});
  });

  it('checks coefficients independently after the source and generator are admitted', () => {
    const math = createMath();
    const source = math.parse('a*x');
    const x = math.parse('x');

    expect(math.symbolic.algebra.polynomial(source, {
      generators: ['x'], mode: 'strict',
      assumptions: scalarAssumptions(math, source, x)
    })).toMatchObject({kind: 'not-representable', reason: 'scalar-unproven'});
  });
});

describe('rational parsing failure propagation', () => {
  it('returns unsupported children from additive and multiplicative branches', () => {
    const math = createMath();
    const options = {generators: ['x'], domain: 'real' as const, mode: 'conditional' as const};

    for (const source of [
      'sin(x) + 1/x',
      '1/x + sin(x)',
      'sin(x) * x',
      'x * sin(x)',
      '-sin(x)',
      'x!'
    ]) {
      expect(math.symbolic.algebra.rational(math.parse(source), options), source)
        .toMatchObject({kind: 'not-representable', reason: 'not-rational'});
    }
  });

  it('uses assumptions to reject denominator obligations before reconstruction', () => {
    const math = createMath();
    const x = math.parse('x');

    expect(math.symbolic.algebra.rational(math.parse('1/x'), {
      generators: ['x'], domain: 'real', mode: 'strict',
      assumptions: [
        ...scalarAssumptions(math, x, math.parse('1/x')),
        assume(math.symbolic.predicates.zero(x))
      ]
    })).toMatchObject({kind: 'not-representable', reason: 'zero-denominator'});
  });
});

describe('configured scalar and exponent representations', () => {
  it('reads scoped and configured symbolic exponents without treating them as generators', () => {
    const scoped = createMath();
    const configured = createMath();
    configured.import({n: 2});

    expect(scoped.symbolic.algebra.polynomial(scoped.parse('x^n'), {
      generators: ['x'], scope: {n: 2}, domain: 'real', mode: 'conditional'
    })).toMatchObject({kind: 'view'});
    expect(configured.symbolic.algebra.polynomial(configured.parse('x^n'), {
      generators: ['x'], domain: 'real', mode: 'conditional'
    })).toMatchObject({kind: 'view'});
  });

  it('accepts BigNumber, Fraction, and bigint integral exponents', () => {
    const big = createMath({number: 'BigNumber'});
    const fraction = createMath({number: 'Fraction'});
    const normal = createMath();
    const x = normal.parse('x');
    const bigintPower = normal.symbolic.nodes.operator('^', 'pow', [
      x,
      normal.symbolic.nodes.constant(2n)
    ]);

    expect(big.symbolic.algebra.polynomial(big.parse('x^2'), {
      generators: ['x'], domain: 'real', mode: 'conditional'
    })).toMatchObject({kind: 'view'});
    expect(fraction.symbolic.algebra.polynomial(fraction.parse('x^2'), {
      generators: ['x'], domain: 'real', mode: 'conditional'
    })).toMatchObject({kind: 'view'});
    expect(normal.symbolic.algebra.polynomial(bigintPower, {
      generators: ['x'], domain: 'real', mode: 'conditional'
    })).toMatchObject({kind: 'view'});
  });

  it('falls back to primitive equality when the configured comparator throws', () => {
    const math = createMath();
    math.import({equal: () => {
      throw new Error('disabled for fallback coverage');
    }}, {override: true});
    const x = math.parse('x');

    for (const constant of [
      math.symbolic.nodes.constant(0),
      math.symbolic.nodes.constant(0n),
      math.symbolic.nodes.constant(math.bignumber(0))
    ]) {
      const expression = math.symbolic.nodes.operator('+', 'add', [x, constant]);
      const result = math.symbolic.algebra.polynomial(expression, {
        generators: ['x'], domain: 'real', mode: 'conditional'
      });
      expect(result.kind).toBe('view');
      if (result.kind === 'view') {
        expect(result.view.rebuild().toString()).toBe('x');
      }
    }
  });
});

describe('arbitrary structural generators and utility ordering', () => {
  it('finds a generator atom through subtree matching without symbol support', () => {
    const math = createMath();
    const atom = math.parse('sin(1)');
    const result = math.symbolic.algebra.linear(math.parse('2*sin(1) + 3'), {
      basis: [atom], domain: 'real', mode: 'conditional'
    });

    expect(result.kind).toBe('view');
    if (result.kind === 'view') {
      expect(result.view.coefficientOf(atom)?.toString()).toBe('2');
    }
  });

  it('orders exponent vectors of unequal length deterministically', () => {
    expect(compareExponentVectors([1], [1, 1])).toBeGreaterThan(0);
    expect(compareExponentVectors([1, 1], [1])).toBeLessThan(0);
  });
});


describe('algebra internal contracts and hard-to-reach paths', () => {
  it('freezes typed success, failure, and limit helpers', () => {
    const math = createMath();
    const node = math.parse('x');
    const success = viewSuccess({node});
    const failure = notRepresentable(node, 'unsupported-node', 'detail');
    const limit = algebraLimit('work', 2, 1);

    expect(Object.isFrozen(success)).toBe(true);
    expect(Object.isFrozen(failure)).toBe(true);
    expect(Object.isFrozen(limit)).toBe(true);
    expect(isAlgebraFailure(success)).toBe(false);
    expect(isAlgebraFailure(failure)).toBe(true);
    expect(totalDegree([2, 3, 4])).toBe(9);
    expect(failure.detail).toBe('detail');
  });

  it('delegates non-algebra canonicalization profiles unchanged', () => {
    const math = createMath();
    const operation = math.symbolic.operation({domain: 'real', mode: 'conditional'});
    const result = math.symbolic.algebra.canonicalizeProfile(
      math.parse('x + 0'),
      operation,
      {
        profile: 'scalar',
        maximumNodes: 1000,
        maximumPasses: 8,
        maximumSteps: 1000
      }
    );

    expect(result.profile).toBe('scalar');
    expect(result.expression.toString()).toBe('x');
  });

  it('detects generator support symbols before exact atom matches', () => {
    const math = createMath();
    const atom = math.parse('sin(x)');

    expect(math.symbolic.algebra.linear(math.parse('x'), {
      basis: [atom], domain: 'real', mode: 'conditional'
    })).toMatchObject({kind: 'not-representable', reason: 'unsupported-node'});
  });

  it('separates canonicalization and expanded-rebuild node limits', () => {
    const math = createMath();
    const result = math.symbolic.algebra.polynomial(math.parse('(x + y)^2'), {
      generators: ['x', 'y'],
      domain: 'real',
      mode: 'conditional',
      algebraLimits: {
        maximumNodes: 100,
        maximumDepth: 100,
        maximumDegree: 10,
        maximumMonomials: 10,
        maximumConvolutions: 100,
        maximumRebuildNodes: 10
      }
    });

    expect(result).toMatchObject({kind: 'limit', limit: 'canonicalNodes'});
  });

});
