import fc from 'fast-check';
import {all, create, isConstantNode} from 'mathjs';
import type {MathNode} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs, PolynomialEngine} from '../src/index.js';

function createMath(config?: Parameters<typeof create>[1]) {
  return importsymbolicjs(config === undefined
    ? create(all!)
    : create(all!, config));
}

function value(node: MathNode, scope: Readonly<Record<string, unknown>> = {}): number {
  const evaluated = node.compile().evaluate(scope);
  if (typeof evaluated !== 'number') {
    if (
      evaluated &&
      typeof evaluated === 'object' &&
      'toNumber' in evaluated &&
      typeof evaluated.toNumber === 'function'
    ) {
      return evaluated.toNumber();
    }
    return Number(evaluated?.valueOf?.());
  }
  return evaluated;
}

function expectSameValue(
  source: MathNode,
  rebuilt: MathNode,
  scopes: readonly Readonly<Record<string, unknown>>[]
): void {
  for (const scope of scopes) {
    expect(value(rebuilt, scope)).toBeCloseTo(value(source, scope), 12);
  }
}

describe('basic transient algebra views', () => {
  it('flattens and deterministically rebuilds scalar sums and products', () => {
    const math = createMath();
    const sumSource = math.parse('z + x - y');
    const productSource = math.parse('z * x * 2');
    const sum = math.symbolic.algebra.sum(sumSource, {
      domain: 'real', mode: 'conditional'
    });
    const product = math.symbolic.algebra.product(productSource, {
      domain: 'real', mode: 'conditional'
    });

    expect(sum.kind).toBe('view');
    expect(product.kind).toBe('view');
    if (sum.kind !== 'view' || product.kind !== 'view') {
      throw new Error('Expected scalar views');
    }
    expect(sum.view.terms).toHaveLength(3);
    expect(product.view.factors.map((factor) => factor.toString()))
      .toEqual(['2', 'x', 'z']);
    expectSameValue(sumSource, sum.view.rebuild(), [{x: 2, y: 3, z: 5}]);
    expectSameValue(productSource, product.view.rebuild(), [{x: 2, z: 5}]);
    expect(Object.isFrozen(sum.view)).toBe(true);
    expect(Object.isFrozen(product.view.factors)).toBe(true);
  });

  it('provides a power view without changing branch-sensitive structure', () => {
    const math = createMath();
    const source = math.parse('(x * y)^a');
    const result = math.symbolic.algebra.power(source, {
      domain: 'complex', mode: 'conditional'
    });

    expect(result.kind).toBe('view');
    if (result.kind !== 'view') {
      throw new Error('Expected a PowerView');
    }
    expect(result.view.base.toString()).toBe('x * y');
    expect(result.view.exponent.toString()).toBe('a');
    expect(result.view.rebuild().toString()).toBe('(x * y) ^ a');
  });

  it('rejects non-power inputs and strict unproved scalar operations', () => {
    const math = createMath();

    expect(math.symbolic.algebra.power(math.parse('x + 1')).kind)
      .toBe('not-representable');
    expect(math.symbolic.algebra.sum(math.parse('x + y'), {
      mode: 'strict'
    })).toMatchObject({kind: 'not-representable', reason: 'scalar-unproven'});
  });
});

describe('affine and arbitrary-basis linear forms', () => {
  it('extracts an affine coefficient and constant independently of the target', () => {
    const math = createMath();
    const source = math.parse('2*x + y*x + 3');
    const result = math.symbolic.algebra.affine(source, {
      generator: 'x', domain: 'real', mode: 'conditional'
    });

    expect(result.kind).toBe('view');
    if (result.kind !== 'view') {
      throw new Error('Expected an AffineView');
    }
    expect(result.view.coefficient.toString()).toBe('2 + y');
    expect(result.view.constant.toString()).toBe('3');
    expect(math.symbolic.algebra.dependsOn(result.view.coefficient, ['x']))
      .toBe(false);
    expectSameValue(source, result.view.rebuild(), [
      {x: -2, y: 4},
      {x: 3, y: -1}
    ]);
  });

  it('extracts linear coefficients over function atoms', () => {
    const math = createMath();
    const sine = math.parse('sin(x)');
    const cosine = math.parse('cos(x)');
    const source = math.parse('a*sin(x) + b*cos(x) + c');
    const result = math.symbolic.algebra.linear(source, {
      basis: [sine, cosine], domain: 'real', mode: 'conditional'
    });

    expect(result.kind).toBe('view');
    if (result.kind !== 'view') {
      throw new Error('Expected a LinearForm');
    }
    expect(result.view.coefficients.map((entry) => entry.toString()))
      .toEqual(['a', 'b']);
    expect(result.view.coefficientOf(0)?.toString()).toBe('a');
    expect(result.view.coefficientOf(cosine)?.toString()).toBe('b');
    expect(result.view.coefficientOf('missing')).toBeNull();
    expect(result.view.constant.toString()).toBe('c');
    expectSameValue(source, result.view.rebuild(), [
      {a: 2, b: 3, c: 4, x: 0.7}
    ]);
  });

  it('treats x*y as linear in x with coefficient y but nonlinear in {x,y}', () => {
    const math = createMath();
    const source = math.parse('x*y');
    const inX = math.symbolic.algebra.linear(source, {
      basis: ['x'], domain: 'real', mode: 'conditional'
    });
    const inBoth = math.symbolic.algebra.linear(source, {
      basis: ['x', 'y'], domain: 'real', mode: 'conditional'
    });

    expect(inX.kind).toBe('view');
    if (inX.kind !== 'view') {
      throw new Error('Expected a LinearForm in x');
    }
    expect(inX.view.coefficientOf('x')?.toString()).toBe('y');
    expect(inBoth).toMatchObject({
      kind: 'not-representable',
      reason: 'nonlinear-product'
    });
  });

  it('rejects generator-dependent coefficients and duplicate basis atoms', () => {
    const math = createMath();
    const sine = math.parse('sin(x)');

    expect(math.symbolic.algebra.linear(math.parse('x*sin(x)'), {
      basis: [sine], domain: 'real', mode: 'conditional'
    })).toMatchObject({kind: 'not-representable'});
    expect(math.symbolic.algebra.linear(math.parse('sin(x)'), {
      basis: [sine, math.parse('sin(x)')]
    })).toMatchObject({kind: 'not-representable', reason: 'duplicate-generator'});
  });
});

describe('sparse polynomial views', () => {
  it('extracts deterministic multivariate monomials and coefficients', () => {
    const math = createMath();
    const source = math.parse('(x + y)^3');
    const result = math.symbolic.algebra.polynomial(source, {
      generators: ['x', 'y'], domain: 'real', mode: 'conditional'
    });

    expect(result.kind).toBe('view');
    if (result.kind !== 'view') {
      throw new Error('Expected a SparsePolynomialView');
    }
    expect(result.view.totalDegree).toBe(3);
    expect(result.view.degree('x')).toBe(3);
    expect(result.view.degree('y')).toBe(3);
    expect(result.view.terms.map((term) => [
      [...term.exponents], term.coefficient.toString()
    ])).toEqual([
      [[3, 0], '1'],
      [[2, 1], '3'],
      [[1, 2], '3'],
      [[0, 3], '1']
    ]);
    expect(result.view.coefficient([2, 1])?.toString()).toBe('3');
    expect(result.view.coefficient([4, 0])).toBeNull();
    expectSameValue(source, result.view.rebuild(), [
      {x: -2, y: 3},
      {x: 1.25, y: -0.5}
    ]);
  });

  it('supports arbitrary MathJS nodes as polynomial generators', () => {
    const math = createMath();
    const atom = math.parse('sin(x)');
    const source = math.parse('sin(x)^2 + 2*sin(x) + 1');
    const result = math.symbolic.algebra.polynomial(source, {
      generators: [atom], domain: 'real', mode: 'conditional'
    });

    expect(result.kind).toBe('view');
    if (result.kind !== 'view') {
      throw new Error('Expected an atom polynomial');
    }
    expect(result.view.degree()).toBe(2);
    expect(result.view.coefficient([2])?.toString()).toBe('1');
    expect(result.view.coefficient([1])?.toString()).toBe('2');
    expectSameValue(source, result.view.rebuild(), [{x: 0.7}]);
  });

  it('keeps generator-independent expressions as coefficients', () => {
    const math = createMath();
    const source = math.parse('a*x^2 + sin(y)*x + c');
    const result = math.symbolic.algebra.polynomial(source, {
      generators: ['x'], domain: 'real', mode: 'conditional'
    });

    expect(result.kind).toBe('view');
    if (result.kind !== 'view') {
      throw new Error('Expected a polynomial in x');
    }
    expect(result.view.coefficient([2])?.toString()).toBe('a');
    expect(result.view.coefficient([1])?.toString()).toBe('sin(y)');
    expect(result.view.coefficient([0])?.toString()).toBe('c');
    for (const term of result.view.terms) {
      expect(math.symbolic.algebra.dependsOn(term.coefficient, ['x'])).toBe(false);
    }
  });

  it.each([
    ['x^-1', 'negative-exponent'],
    ['x^1.5', 'nonintegral-exponent'],
    ['x^a', 'nonconstant-exponent'],
    ['1/(x + 1)', 'generator-denominator']
  ] as const)('rejects non-polynomial form %s', (source, reason) => {
    const math = createMath();

    expect(math.symbolic.algebra.polynomial(math.parse(source), {
      generators: ['x'], domain: 'real', mode: 'conditional'
    })).toMatchObject({kind: 'not-representable', reason});
  });

  it('round-trips generated integer polynomials', () => {
    const math = createMath();

    fc.assert(fc.property(
      fc.array(fc.integer({min: -5, max: 5}), {minLength: 1, maxLength: 6}),
      fc.integer({min: -3, max: 3}),
      (coefficients, x) => {
        const sourceText = coefficients
          .map((coefficient, degree) => `(${coefficient})*x^${degree}`)
          .join(' + ');
        const source = math.parse(sourceText);
        const result = math.symbolic.algebra.polynomial(source, {
          generators: ['x'], domain: 'real', mode: 'conditional'
        });
        expect(result.kind).toBe('view');
        if (result.kind === 'view') {
          expect(value(result.view.rebuild(), {x}))
            .toBeCloseTo(value(source, {x}), 12);
        }
      }
    ), {numRuns: 40});
  });

  it('preserves configured numeric coefficient types', () => {
    const fraction = createMath({number: 'Fraction'});
    const result = fraction.symbolic.algebra.polynomial(
      fraction.parse('(x + 1/3) * (x + 2/3)'),
      {generators: ['x'], domain: 'real', mode: 'conditional'}
    );

    expect(result.kind).toBe('view');
    if (result.kind !== 'view') {
      throw new Error('Expected configured polynomial coefficients');
    }
    const constant = result.view.coefficient([0]);
    expect(constant && isConstantNode(constant)).toBe(true);
    if (!constant || !isConstantNode(constant)) {
      throw new Error('Expected a configured constant node');
    }
    expect(fraction.isFraction(constant.value)).toBe(true);
    expect(value(constant)).toBeCloseTo(2 / 9, 12);
  });
});

describe('rational-function views and profile canonicalization', () => {
  it('preserves every original denominator obligation', () => {
    const math = createMath();
    const source = math.parse('1/x + 1/(x + 1)');
    const result = math.symbolic.algebra.rational(source, {
      generators: ['x'], domain: 'real', mode: 'conditional'
    });

    expect(result.kind).toBe('view');
    if (result.kind !== 'view') {
      throw new Error('Expected a RationalFunctionView');
    }
    expect(result.view.numerator.degree()).toBe(1);
    expect(result.view.denominator.degree()).toBe(2);
    const nonzero = result.view.requirements
      .filter((predicate) => predicate.kind === 'property' &&
        predicate.property === 'nonzero')
      .map((predicate) => predicate.expression.toString());
    expect(nonzero).toEqual(expect.arrayContaining(['x', 'x + 1']));
    expectSameValue(source, result.view.rebuild(), [
      {x: 2},
      {x: -2}
    ]);
  });

  it('accepts negative integral powers but rejects nonintegral powers', () => {
    const math = createMath();
    const reciprocal = math.symbolic.algebra.rational(math.parse('x^-2'), {
      generators: ['x'], domain: 'real', mode: 'conditional'
    });

    expect(reciprocal.kind).toBe('view');
    if (reciprocal.kind === 'view') {
      expect(reciprocal.view.numerator.degree()).toBe(0);
      expect(reciprocal.view.denominator.degree()).toBe(2);
    }
    expect(math.symbolic.algebra.rational(math.parse('x^1.5'), {
      generators: ['x'], domain: 'real', mode: 'conditional'
    })).toMatchObject({
      kind: 'not-representable', reason: 'nonintegral-exponent'
    });
  });

  it('canonicalizes polynomial and rational profiles idempotently', () => {
    const math = createMath();
    const cases = [
      {
        profile: 'polynomial' as const,
        source: 'y*x + x^2 + 2*x*x',
        generators: ['x', 'y']
      },
      {
        profile: 'rational' as const,
        source: '1/x + 1/(x + 1)',
        generators: ['x']
      }
    ];

    for (const entry of cases) {
      const first = math.symbolic.canonicalize(math.parse(entry.source), {
        profile: entry.profile,
        generators: entry.generators,
        domain: 'real',
        mode: 'conditional'
      });
      const second = math.symbolic.canonicalize(first.expression, {
        profile: entry.profile,
        generators: entry.generators,
        domain: 'real',
        mode: 'conditional'
      });
      expect(first.complete).toBe(true);
      expect(first.trace.some((step) =>
        step.rule === `rebuild-${entry.profile}`
      )).toBe(true);
      expect(second.changed).toBe(false);
      expect(math.symbolic.structure.equals(first.expression, second.expression))
        .toBe(true);
    }
  });

  it('keeps constant polynomial-profile expressions valid without generators', () => {
    const math = createMath();
    const result = math.symbolic.canonicalize(math.parse('2 + 3'), {
      profile: 'polynomial'
    });

    expect(result.expression.toString()).toBe('5');
    expect(result.complete).toBe(true);
  });
});

describe('algebra limits and legacy adapters', () => {
  it.each([
    [{maximumDegree: 1}, 'algebraDegree'],
    [{maximumMonomials: 1}, 'algebraMonomials'],
    [{maximumConvolutions: 0}, 'algebraConvolutions'],
    [{maximumNodes: 1}, 'algebraNodes'],
    [{maximumDepth: 1}, 'algebraDepth'],
    [{maximumRebuildNodes: 1}, 'canonicalNodes']
  ] as const)('returns a typed limit for %o', (algebraLimits, limit) => {
    const math = createMath();
    const result = math.symbolic.algebra.polynomial(math.parse('(x + y)^2'), {
      generators: ['x', 'y'],
      domain: 'real',
      mode: 'conditional',
      algebraLimits
    });

    expect(result).toMatchObject({kind: 'limit', limit});
  });

  it('keeps PolynomialEngine diagnostics delegated to the shared view', () => {
    const math = createMath();
    const engine = new PolynomialEngine({
      ConstantNode: math.ConstantNode,
      complex: math.complex,
      EqualityNode: math.EqualityNode,
      FunctionNode: math.FunctionNode,
      OperatorNode: math.OperatorNode,
      simplify: math.simplify,
      SymbolNode: math.SymbolNode,
      symbolicKernel: math.symbolicKernel
    });
    const source = math.parse('2*x + 3');
    const view = math.symbolic.algebra.polynomial(source, {
      generators: ['x'], domain: 'real', mode: 'conditional'
    });

    expect(view.kind).toBe('view');
    expect(engine.debugPolynomial(source, 'x')).not.toBeNull();
    if (view.kind === 'view') {
      expectSameValue(
        math.parse(engine.debugPolynomial(source, 'x')!),
        view.view.rebuild(),
        [{x: -2}, {x: 4}]
      );
    }
  });
});
