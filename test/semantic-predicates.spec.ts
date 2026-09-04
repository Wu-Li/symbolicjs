import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import {assume} from '../src/core/assumptions.js';
import {
  conditionToPredicate,
  predicateToCondition
} from '../src/core/legacy-condition.js';
import type {Condition} from '../src/solve-types.js';

function createMath(config?: Parameters<typeof create>[1]) {
  return importsymbolicjs(create(all!, config));
}

describe('3-valued symbolic predicates', () => {
  it('classifies exact scalar constants conservatively', () => {
    const math = createMath();
    const predicates = math.symbolic.predicates;
    const two = math.parse('2');
    const negativeThree = math.parse('-3');
    const zero = math.parse('0');
    const pi = math.parse('pi');
    const imaginary = math.parse('i');

    for (const predicate of [
      predicates.integer(two),
      predicates.rational(two),
      predicates.real(two),
      predicates.complex(two),
      predicates.positive(two),
      predicates.nonzero(two),
      predicates.finite(two),
      predicates.defined(two),
      predicates.even(two),
      predicates.scalar(two),
      predicates.commutative(two)
    ]) {
      expect(math.symbolic.ask(predicate).truth).toBe('proven');
    }

    expect(math.symbolic.ask(predicates.negative(negativeThree)).truth)
      .toBe('proven');
    expect(math.symbolic.ask(predicates.odd(negativeThree)).truth)
      .toBe('proven');
    expect(math.symbolic.ask(predicates.zero(zero)).truth).toBe('proven');
    expect(math.symbolic.ask(predicates.nonzero(zero)).truth).toBe('disproven');
    expect(math.symbolic.ask(predicates.real(pi)).truth).toBe('proven');
    expect(math.symbolic.ask(predicates.rational(pi)).truth).toBe('unknown');
    expect(math.symbolic.ask(predicates.complex(imaginary)).truth).toBe('proven');
    expect(math.symbolic.ask(predicates.real(imaginary)).truth).toBe('disproven');
  });

  it('preserves configured BigNumber, Fraction, and Complex semantics', () => {
    const big = createMath({number: 'BigNumber'});
    const fraction = createMath({number: 'Fraction'});
    const complex = createMath();

    const bigTwo = big.symbolic.nodes.constant(big.bignumber(2));
    const third = fraction.symbolic.nodes.constant(fraction.fraction(1, 3));
    const imaginary = complex.symbolic.nodes.constant(complex.complex(0, 2));

    expect(big.symbolic.ask(big.symbolic.predicates.integer(bigTwo)).truth)
      .toBe('proven');
    expect(fraction.symbolic.ask(fraction.symbolic.predicates.rational(third)).truth)
      .toBe('proven');
    expect(complex.symbolic.ask(complex.symbolic.predicates.complex(imaginary)).truth)
      .toBe('proven');
    expect(complex.symbolic.ask(complex.symbolic.predicates.real(imaginary)).truth)
      .toBe('disproven');
  });

  it('uses assumptions before structural and numeric inference', () => {
    const math = createMath();
    const x = math.parse('x');
    const assumptions = math.symbolic.assumptions([
      assume(math.symbolic.predicates.positive(x))
    ]);

    expect(math.symbolic.ask(
      math.symbolic.predicates.real(x),
      {assumptions}
    ).truth).toBe('proven');
    expect(math.symbolic.ask(
      math.symbolic.predicates.zero(x),
      {assumptions}
    ).truth).toBe('disproven');
    expect(math.symbolic.ask(math.symbolic.predicates.real(x)).truth)
      .toBe('unknown');
  });

  it('distinguishes strict rejection from conditional obligations', () => {
    const math = createMath();
    const x = math.parse('x');
    const predicate = math.symbolic.predicates.positive(x);

    const strict = math.symbolic.require(predicate);
    const conditional = math.symbolic.require(predicate, {mode: 'conditional'});
    const disproven = math.symbolic.require(predicate, {
      assumptions: [assume(math.symbolic.predicates.nonpositive(x))]
    });

    expect(strict.kind).toBe('rejected');
    if (strict.kind === 'rejected') {
      expect(strict.reason).toBe('unproven');
    }
    expect(conditional.kind).toBe('conditional');
    if (conditional.kind === 'conditional') {
      expect(conditional.requirements).toEqual([predicate]);
    }
    expect(disproven.kind).toBe('rejected');
    if (disproven.kind === 'rejected') {
      expect(disproven.reason).toBe('disproven');
    }
  });
});

describe('structural semantic inference', () => {
  it('infers domains and definedness for arithmetic from assumptions', () => {
    const math = createMath();
    const x = math.parse('x');
    const y = math.parse('y');
    const quotient = math.parse('x / y');
    const product = math.parse('x * y');
    const assumptions = math.symbolic.assumptions([
      assume(math.symbolic.predicates.real(x)),
      assume(math.symbolic.predicates.real(y)),
      assume(math.symbolic.predicates.nonzero(y)),
      assume(math.symbolic.predicates.nonzero(x))
    ]);

    expect(math.symbolic.ask(
      math.symbolic.predicates.real(quotient),
      {assumptions}
    ).truth).toBe('proven');
    expect(math.symbolic.ask(
      math.symbolic.predicates.defined(quotient),
      {assumptions, domain: 'real'}
    ).truth).toBe('proven');
    expect(math.symbolic.ask(
      math.symbolic.predicates.nonzero(product),
      {assumptions}
    ).truth).toBe('proven');
  });

  it('uses registered function semantics without treating opaque functions as known', () => {
    const math = createMath();
    const x = math.parse('x');
    const assumptions = [assume(math.symbolic.predicates.positive(x))];

    expect(math.symbolic.ask(
      math.symbolic.predicates.real(math.parse('sqrt(x)')),
      {assumptions, domain: 'real'}
    ).truth).toBe('proven');
    expect(math.symbolic.ask(
      math.symbolic.predicates.positive(math.parse('exp(x)')),
      {assumptions, domain: 'real'}
    ).truth).toBe('proven');
    expect(math.symbolic.ask(
      math.symbolic.predicates.defined(math.parse('missing(x)')),
      {assumptions, domain: 'real'}
    ).truth).toBe('unknown');
  });
});

describe('definedness analysis', () => {
  it('returns explicit real-domain obligations and resolves them from assumptions', () => {
    const math = createMath();
    const expression = math.parse('1/x + sqrt(y) + log(z)');
    const unresolved = math.symbolic.definedness(expression, {domain: 'real'});
    const requirements = unresolved.requirements.map((predicate) =>
      predicate.kind === 'domain'
        ? `domain:${predicate.domain}:${predicate.expression.toString()}`
        : `${predicate.property}:${predicate.expression.toString()}`
    );

    expect(unresolved.truth).toBe('unknown');
    expect(requirements).toEqual(expect.arrayContaining([
      'defined:x',
      'defined:y',
      'defined:z',
      'nonnegative:y',
      'nonzero:x',
      'positive:z'
    ]));

    const assumptions = math.symbolic.assumptions([
      assume(math.symbolic.predicates.nonzero(math.parse('x'))),
      assume(math.symbolic.predicates.nonnegative(math.parse('y'))),
      assume(math.symbolic.predicates.positive(math.parse('z')))
    ]);
    expect(math.symbolic.definedness(expression, {
      domain: 'real', assumptions
    }).truth).toBe('proven');
  });

  it('distinguishes real and complex definedness requirements', () => {
    const math = createMath();
    const squareRoot = math.parse('sqrt(-1)');
    const logarithm = math.parse('log(0)');

    expect(math.symbolic.definedness(squareRoot, {domain: 'real'}).truth)
      .toBe('disproven');
    expect(math.symbolic.definedness(squareRoot, {domain: 'complex'}).truth)
      .toBe('proven');
    expect(math.symbolic.definedness(logarithm, {domain: 'real'}).truth)
      .toBe('disproven');
    expect(math.symbolic.definedness(logarithm, {domain: 'complex'}).truth)
      .toBe('disproven');
  });

  it('keeps custom functions opaque unless assumed or successfully evaluated', () => {
    const math = createMath();
    math.import({twice: (value: number) => value * 2});
    const constant = math.parse('twice(2)');
    const symbolic = math.parse('twice(x)');
    const missing = math.parse('missing(x)');

    expect(math.symbolic.ask(math.symbolic.predicates.defined(constant)).truth)
      .toBe('proven');
    expect(math.symbolic.ask(
      math.symbolic.predicates.defined(symbolic),
      {scope: {x: 3}}
    ).truth).toBe('proven');
    expect(math.symbolic.ask(math.symbolic.predicates.defined(symbolic)).truth)
      .toBe('unknown');
    expect(math.symbolic.ask(math.symbolic.predicates.defined(missing)).truth)
      .toBe('unknown');

    const assumptions = [
      assume(math.symbolic.predicates.defined(math.parse('x'))),
      assume(math.symbolic.predicates.defined(missing))
    ];
    expect(math.symbolic.definedness(missing, {
      assumptions,
      domain: 'real'
    }).truth).toBe('proven');
  });
});

describe('legacy condition compatibility', () => {
  it('round-trips every legacy condition kind through symbolic predicates', () => {
    const math = createMath();
    const expression = math.parse('x');
    const kinds = [
      'zero',
      'nonzero',
      'positive',
      'nonnegative',
      'negative',
      'nonpositive',
      'defined'
    ] as const;

    for (const kind of kinds) {
      const condition: Condition = {kind, expression};
      expect(predicateToCondition(conditionToPredicate(
        math.symbolic.predicates,
        condition
      ))).toEqual(condition);
    }
    expect(predicateToCondition(math.symbolic.predicates.real(expression)))
      .toBeNull();
  });

  it('preserves the existing kernel definedness and normalization surface', () => {
    const math = createMath();
    const conditions = math.symbolicKernel.conditionsForDefinedness(math.parse(
      '1/a + b^(-2) + c^0.5 + sqrt(d) + log(e) + log10(f) + nthRoot(g, 4)'
    ));

    expect(conditions.map((condition) =>
      `${condition.kind}:${condition.expression.toString()}`
    )).toEqual([
      'nonnegative:c',
      'nonnegative:d',
      'nonnegative:g',
      'nonzero:a',
      'nonzero:b',
      'positive:f'
    ]);

    const x = math.parse('x');
    expect(math.symbolicKernel.normalizeConditions([
      math.symbolicKernel.condition('zero', x),
      math.symbolicKernel.condition('nonzero', x)
    ]).contradictory).toBe(true);
    expect(math.symbolicKernel.normalizeConditions([
      math.symbolicKernel.condition('positive', math.parse('2'))
    ])).toEqual({conditions: [], contradictory: false});
  });
});
