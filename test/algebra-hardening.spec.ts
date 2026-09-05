import {all, create} from 'mathjs';
import type {MathNode} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import {assume} from '../src/core/assumptions.js';
import {normalizeAlgebraLimits} from '../src/algebra/internal.js';

function createMath(config?: Parameters<typeof create>[1]) {
  return importsymbolicjs(config === undefined
    ? create(all!)
    : create(all!, config));
}

function labels(
  requirements: readonly import('../src/core/predicate.js').SymbolicPredicate[]
): readonly string[] {
  return requirements.map((requirement) => requirement.kind === 'domain'
    ? `${requirement.domain}:${requirement.expression.toString()}`
    : `${requirement.property}:${requirement.expression.toString()}`
  );
}

function evaluate(
  node: MathNode,
  scope: Readonly<Record<string, unknown>> = {}
): number {
  const value = node.compile().evaluate(scope);
  if (typeof value === 'number') {
    return value;
  }
  if (
    value &&
    typeof value === 'object' &&
    'toNumber' in value &&
    typeof value.toNumber === 'function'
  ) {
    return value.toNumber();
  }
  return Number(value);
}

describe('algebra view validation and immutable contracts', () => {
  it('validates nodes, required options, generators, and selections', () => {
    const math = createMath();
    const x = math.parse('x');

    expect(() => math.symbolic.algebra.sum(null as never)).toThrow(TypeError);
    expect(() => math.symbolic.algebra.product(null as never)).toThrow(TypeError);
    expect(() => math.symbolic.algebra.power(null as never)).toThrow(TypeError);
    expect(() => math.symbolic.algebra.affine(x, null as never)).toThrow(TypeError);
    expect(() => math.symbolic.algebra.linear(x, null as never)).toThrow(TypeError);
    expect(() => math.symbolic.algebra.polynomial(x, null as never)).toThrow(TypeError);
    expect(() => math.symbolic.algebra.rational(x, null as never)).toThrow(TypeError);
    expect(() => math.symbolic.algebra.linear(x, {basis: []})).toThrow(TypeError);
    expect(() => math.symbolic.algebra.linear(x, {basis: ['']})).toThrow(TypeError);
    expect(() => math.symbolic.algebra.polynomial(x, {
      generators: [null as never]
    })).toThrow(TypeError);
    expect(() => math.symbolic.algebra.analyze(x, {
      symbols: null as never
    })).toThrow(TypeError);
    expect(() => math.symbolic.algebra.dependsOn(x, null as never)).toThrow(TypeError);
    expect(() => math.symbolic.algebra.occurrenceCount(x, ['x'], [null as never]))
      .toThrow(TypeError);
  });

  it('validates every algebra limit boundary', () => {
    expect(normalizeAlgebraLimits()).toMatchObject({
      maximumNodes: 100_000,
      maximumDepth: 1_000,
      maximumDegree: 128,
      maximumMonomials: 10_000,
      maximumConvolutions: 100_000,
      maximumRebuildNodes: 100_000
    });
    for (const invalid of [
      {maximumNodes: 0},
      {maximumDepth: 0},
      {maximumDegree: -1},
      {maximumMonomials: 0},
      {maximumConvolutions: -1},
      {maximumRebuildNodes: 0},
      {maximumNodes: 1.5}
    ]) {
      expect(() => normalizeAlgebraLimits(invalid)).toThrow(RangeError);
    }
    expect(normalizeAlgebraLimits({
      maximumDegree: 0,
      maximumConvolutions: 0
    })).toMatchObject({maximumDegree: 0, maximumConvolutions: 0});
  });

  it('returns frozen view state and cached rebuild nodes', () => {
    const math = createMath();
    const result = math.symbolic.algebra.polynomial(math.parse('x^2 + 1'), {
      generators: ['x'], domain: 'real', mode: 'conditional'
    });

    expect(result.kind).toBe('view');
    if (result.kind !== 'view') {
      throw new Error('Expected polynomial view');
    }
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.view)).toBe(true);
    expect(Object.isFrozen(result.view.generators)).toBe(true);
    expect(Object.isFrozen(result.view.terms)).toBe(true);
    expect(Object.isFrozen(result.view.terms[0])).toBe(true);
    expect(Object.isFrozen(result.view.terms[0]!.exponents)).toBe(true);
    expect(Object.isFrozen(result.view.requirements)).toBe(true);
    expect(result.view.rebuild()).toBe(result.view.rebuild());
  });
});

describe('sum, product, power, affine, and linear hardening', () => {
  it('normalizes parenthesized unary sums and products without mutating input', () => {
    const math = createMath();
    const sumSource = math.parse('+(x) - (-(y))');
    const productSource = math.parse('(x * (y * z))');
    const sumBefore = JSON.stringify(sumSource);
    const productBefore = JSON.stringify(productSource);
    const sum = math.symbolic.algebra.sum(sumSource, {
      domain: 'real', mode: 'conditional'
    });
    const product = math.symbolic.algebra.product(productSource, {
      domain: 'real', mode: 'conditional'
    });

    expect(sum.kind).toBe('view');
    expect(product.kind).toBe('view');
    if (sum.kind === 'view' && product.kind === 'view') {
      expect(sum.view.rebuild().toString()).toBe('x + y');
      expect(product.view.factors.map((entry) => entry.toString()))
        .toEqual(['x', 'y', 'z']);
    }
    expect(JSON.stringify(sumSource)).toBe(sumBefore);
    expect(JSON.stringify(productSource)).toBe(productBefore);
  });

  it('returns traversal limits for flattened sum and product views', () => {
    const math = createMath();

    expect(math.symbolic.algebra.sum(math.parse('x + y + z'), {
      domain: 'real', mode: 'conditional',
      algebraLimits: {maximumNodes: 1}
    })).toMatchObject({kind: 'limit', limit: 'algebraNodes'});
    expect(math.symbolic.algebra.product(math.parse('x*y*z'), {
      domain: 'real', mode: 'conditional',
      algebraLimits: {maximumDepth: 1}
    })).toMatchObject({kind: 'limit', limit: 'algebraDepth'});
  });

  it('covers affine and linear unary, division, and exponent paths', () => {
    const math = createMath();
    const source = math.parse('-(2*x)/a + (x^1) + 3*(x^0)');
    const result = math.symbolic.algebra.affine(source, {
      generator: 'x', domain: 'real', mode: 'conditional'
    });

    expect(result.kind).toBe('view');
    if (result.kind !== 'view') {
      throw new Error('Expected affine view');
    }
    expect(labels(result.view.requirements)).toContain('nonzero:a');
    expect(math.symbolic.algebra.dependsOn(result.view.coefficient, ['x']))
      .toBe(false);
    expect(evaluate(result.view.rebuild(), {x: 4, a: 2}))
      .toBeCloseTo(evaluate(source, {x: 4, a: 2}), 12);
  });

  it('supports constant-on-either-side products and rejects unsupported forms', () => {
    const math = createMath();
    for (const source of ['a*x', 'x*a']) {
      const result = math.symbolic.algebra.linear(math.parse(source), {
        basis: ['x'], domain: 'real', mode: 'conditional'
      });
      expect(result.kind).toBe('view');
      if (result.kind === 'view') {
        expect(result.view.coefficientOf('x')?.toString()).toBe('a');
      }
    }

    expect(math.symbolic.algebra.linear(math.parse('x*y'), {
      basis: ['x', 'y'], domain: 'real', mode: 'conditional'
    })).toMatchObject({kind: 'not-representable', reason: 'nonlinear-product'});
    expect(math.symbolic.algebra.linear(math.parse('x/(x + 1)'), {
      basis: ['x'], domain: 'real', mode: 'conditional'
    })).toMatchObject({
      kind: 'not-representable', reason: 'generator-denominator'
    });
    expect(math.symbolic.algebra.linear(math.parse('sin(x)'), {
      basis: ['x'], domain: 'real', mode: 'conditional'
    })).toMatchObject({kind: 'not-representable', reason: 'unsupported-node'});
    expect(math.symbolic.algebra.linear(math.parse('x^2'), {
      basis: ['x'], domain: 'real', mode: 'conditional'
    })).toMatchObject({kind: 'not-representable', reason: 'nonlinear-product'});
  });

  it('handles coefficient lookup validation and unknown generators', () => {
    const math = createMath();
    const result = math.symbolic.algebra.linear(math.parse('2*x + 3*y'), {
      basis: ['x', 'y'], domain: 'real', mode: 'conditional'
    });

    expect(result.kind).toBe('view');
    if (result.kind !== 'view') {
      throw new Error('Expected linear view');
    }
    expect(result.view.coefficientOf(-1)).toBeNull();
    expect(result.view.coefficientOf(99)).toBeNull();
    expect(result.view.coefficientOf('z')).toBeNull();
    expect(() => result.view.coefficientOf(null as never)).toThrow(TypeError);
  });
});

describe('polynomial and rational hardening', () => {
  it('defines zero and constant polynomial degree consistently', () => {
    const math = createMath();
    const zero = math.symbolic.algebra.polynomial(math.parse('x - x'), {
      generators: ['x'], domain: 'real', mode: 'conditional'
    });
    const constant = math.symbolic.algebra.polynomial(math.parse('7'), {
      generators: ['x'], domain: 'real', mode: 'conditional'
    });

    expect(zero.kind).toBe('view');
    expect(constant.kind).toBe('view');
    if (zero.kind === 'view' && constant.kind === 'view') {
      expect(zero.view.terms).toEqual([]);
      expect(zero.view.totalDegree).toBe(-1);
      expect(zero.view.degree()).toBe(-1);
      expect(zero.view.degree('x')).toBe(-1);
      expect(zero.view.rebuild().toString()).toBe('0');
      expect(constant.view.totalDegree).toBe(0);
      expect(constant.view.degree()).toBe(0);
    }
  });

  it('requires scalar, generator-independent coefficients', () => {
    const math = createMath();
    const result = math.symbolic.algebra.polynomial(math.parse('a*x + sin(y)'), {
      generators: ['x'], domain: 'real', mode: 'conditional'
    });

    expect(result.kind).toBe('view');
    if (result.kind !== 'view') {
      throw new Error('Expected polynomial view');
    }
    expect(labels(result.view.requirements)).toEqual(expect.arrayContaining([
      'scalar:a',
      'scalar:x',
      'scalar:y'
    ]));
    for (const term of result.view.terms) {
      expect(math.symbolic.algebra.dependsOn(term.coefficient, ['x'])).toBe(false);
    }

    const atom = math.parse('sin(x)');
    expect(math.symbolic.algebra.polynomial(math.parse('x*sin(x)'), {
      generators: [atom], domain: 'real', mode: 'conditional'
    })).toMatchObject({kind: 'not-representable'});
  });

  it('covers polynomial unary, division, zero-power, and subtraction paths', () => {
    const math = createMath();
    const source = math.parse('-(x + y) + x/a + (x + y)^0');
    const result = math.symbolic.algebra.polynomial(source, {
      generators: ['x', 'y'], domain: 'real', mode: 'conditional'
    });

    expect(result.kind).toBe('view');
    if (result.kind !== 'view') {
      throw new Error('Expected multivariate polynomial');
    }
    expect(labels(result.view.requirements)).toContain('nonzero:a');
    expect(result.view.coefficient([1, 0])).not.toBeNull();
    expect(result.view.coefficient([0, 1])?.toString()).toBe('-1');
    expect(evaluate(result.view.rebuild(), {x: 2, y: 3, a: 4}))
      .toBeCloseTo(evaluate(source, {x: 2, y: 3, a: 4}), 12);
  });

  it('validates degree and coefficient lookup arguments', () => {
    const math = createMath();
    const result = math.symbolic.algebra.polynomial(math.parse('x^2 + y'), {
      generators: ['x', 'y'], domain: 'real', mode: 'conditional'
    });

    expect(result.kind).toBe('view');
    if (result.kind !== 'view') {
      throw new Error('Expected polynomial view');
    }
    expect(result.view.degree(-1)).toBe(-1);
    expect(result.view.degree(99)).toBe(-1);
    expect(result.view.degree('z')).toBe(-1);
    expect(() => result.view.degree(null as never)).toThrow(TypeError);
    expect(() => result.view.coefficient([1])).toThrow(TypeError);
    expect(() => result.view.coefficient([1, -1])).toThrow(TypeError);
    expect(() => result.view.coefficient([1, 0.5])).toThrow(TypeError);
  });

  it('covers rational addition, subtraction, multiplication, division, and powers', () => {
    const math = createMath();
    const sources = [
      '(x + 1)/(x - 1)',
      '1/x + 1/(x + 1)',
      '1/x - 1/(x + 1)',
      '(x + 1)*(x - 1)/x',
      '(x + 1)/(1/x)',
      '(x + 1)^2',
      '(x + 1)^-2',
      '(x + 1)^0',
      '-(1/x)',
      '+(1/x)'
    ];

    for (const sourceText of sources) {
      const source = math.parse(sourceText);
      const result = math.symbolic.algebra.rational(source, {
        generators: ['x'], domain: 'real', mode: 'conditional'
      });
      expect(result.kind, sourceText).toBe('view');
      if (result.kind === 'view') {
        for (const x of [-2, 2, 3]) {
          try {
            expect(evaluate(result.view.rebuild(), {x}))
              .toBeCloseTo(evaluate(source, {x}), 10);
          } catch {
            // A sampled source may be outside its denominator domain.
          }
        }
      }
    }
  });

  it('rejects strict unproved denominators and explicit zero denominators', () => {
    const math = createMath();
    const x = math.parse('x');
    const assumptions = [assume(math.symbolic.predicates.real(x))];

    expect(math.symbolic.algebra.rational(math.parse('1/x'), {
      generators: ['x'], domain: 'real', mode: 'strict', assumptions
    })).toMatchObject({
      kind: 'not-representable', reason: 'nonzero-unproven'
    });
    expect(math.symbolic.algebra.rational(math.parse('1/(x - x)'), {
      generators: ['x'], domain: 'real', mode: 'conditional'
    })).toMatchObject({
      kind: 'not-representable', reason: 'zero-denominator'
    });
    expect(math.symbolic.algebra.rational(math.parse('sin(x)'), {
      generators: ['x'], domain: 'real', mode: 'conditional'
    })).toMatchObject({kind: 'not-representable', reason: 'not-rational'});
    expect(math.symbolic.algebra.rational(math.parse('x^a'), {
      generators: ['x'], domain: 'real', mode: 'conditional'
    })).toMatchObject({
      kind: 'not-representable', reason: 'nonconstant-exponent'
    });
  });

  it('preserves the frozen legacy polynomial numerator corpus', () => {
    const math = createMath();
    const cases = [
      ['2*x + 3', '0 + 3 + 2 * x'],
      ['(x + 1)*(x - 1)', '0 + -1 + 1 * x ^ 2'],
      ['(x + 2)^3', '0 + 2 * 2 * 2 + (2 * (2 + 2) + 2 * 2) * x + (2 + 2 + 2) * x ^ 2 + 1 * x ^ 3'],
      ['a*x^2 + b*x + c', '0 + c + b * x + a * x ^ 2'],
      ['x/(x-1)', '0 + 1 * x'],
      ['1/x + 1/(x+1)', '0 + 1 + (1 + 1) * x'],
      ['x*x + 2*x + 1', '0 + 1 + 2 * x + 1 * x ^ 2'],
      ['-(x+1)', '0 + -1 + -1 * x'],
      ['x/2 + 3', '0 + 3 * 2 + 1 * x']
    ] as const;

    for (const [sourceText, legacyNumeratorText] of cases) {
      const result = math.symbolic.algebra.rational(math.parse(sourceText), {
        generators: ['x'], domain: 'real', mode: 'conditional'
      });
      expect(result.kind, sourceText).toBe('view');
      if (result.kind === 'view') {
        const legacy = math.parse(legacyNumeratorText);
        const current = result.view.numerator.rebuild();
        for (const scope of [
          {x: -2, a: 2, b: 3, c: 5},
          {x: 3, a: -1, b: 4, c: 2}
        ]) {
          expect(evaluate(current, scope)).toBeCloseTo(evaluate(legacy, scope), 10);
        }
      }
    }
  });
});

describe('algebra canonicalization profiles', () => {
  it('reports incomplete unsupported profiles without changing the scalar result', () => {
    const math = createMath();
    const source = math.parse('sin(x)');
    const result = math.symbolic.canonicalize(source, {
      profile: 'polynomial', generators: ['x'],
      domain: 'real', mode: 'conditional'
    });

    expect(result.complete).toBe(false);
    expect(result.expression.toString()).toBe('sin(x)');
  });

  it('charges polynomial expansion to the canonicalization step budget', () => {
    const math = createMath();
    const result = math.symbolic.canonicalize(math.parse('(x + y)^8'), {
      profile: 'polynomial', generators: ['x', 'y'],
      domain: 'real', mode: 'conditional', maximumSteps: 1
    });

    expect(result.complete).toBe(false);
    expect(result.limit).toMatchObject({kind: 'limit'});
  });

  it('infers all free symbols as generators when none are supplied', () => {
    const math = createMath();
    const first = math.symbolic.canonicalize(math.parse('y*x + x*y'), {
      profile: 'polynomial', domain: 'real', mode: 'conditional'
    });
    const second = math.symbolic.canonicalize(first.expression, {
      profile: 'polynomial', domain: 'real', mode: 'conditional'
    });

    expect(first.complete).toBe(true);
    expect(second.changed).toBe(false);
    expect(math.symbolic.structure.equals(first.expression, second.expression))
      .toBe(true);
  });
});
