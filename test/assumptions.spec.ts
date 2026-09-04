import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import {assume, AssumptionSet} from '../src/core/assumptions.js';
import {
  broaderDomain,
  domainImplies,
  narrowerDomain,
  SYMBOLIC_DOMAINS,
  validateDomain
} from '../src/core/domains.js';

describe('symbolic domain lattice', () => {
  it('orders integer, rational, real, and complex domains', () => {
    expect(SYMBOLIC_DOMAINS).toEqual([
      'integer', 'rational', 'real', 'complex'
    ]);
    expect(domainImplies('integer', 'complex')).toBe(true);
    expect(domainImplies('rational', 'real')).toBe(true);
    expect(domainImplies('real', 'rational')).toBe(false);
    expect(narrowerDomain('real', 'rational')).toBe('rational');
    expect(broaderDomain('integer', 'complex')).toBe('complex');
    expect(validateDomain('real')).toBe('real');
    expect(() => validateDomain('matrix')).toThrow(TypeError);
    expect(Object.isFrozen(SYMBOLIC_DOMAINS)).toBe(true);
  });
});

describe('immutable assumption sets', () => {
  const math = importsymbolicjs(create(all!));
  const x = math.symbolic.nodes.symbol('x');
  const predicates = math.symbolic.predicates;

  it('applies domain implications and scalar eligibility', () => {
    const assumptions = new AssumptionSet([
      assume(predicates.integer(x))
    ]);

    expect(assumptions.ask(predicates.integer(x)).truth).toBe('proven');
    expect(assumptions.ask(predicates.rational(x)).truth).toBe('proven');
    expect(assumptions.ask(predicates.real(x)).truth).toBe('proven');
    expect(assumptions.ask(predicates.complex(x)).truth).toBe('proven');
    expect(assumptions.ask(predicates.scalar(x)).truth).toBe('proven');
    expect(assumptions.ask(predicates.commutative(x)).truth).toBe('proven');
    expect(assumptions.ask(predicates.defined(x)).truth).toBe('proven');
  });

  it('applies sign, parity, and combined implications', () => {
    const positive = new AssumptionSet([
      assume(predicates.positive(x))
    ]);
    expect(positive.ask(predicates.nonnegative(x)).truth).toBe('proven');
    expect(positive.ask(predicates.nonzero(x)).truth).toBe('proven');
    expect(positive.ask(predicates.real(x)).truth).toBe('proven');
    expect(positive.ask(predicates.zero(x)).truth).toBe('disproven');
    expect(positive.ask(predicates.nonpositive(x)).truth).toBe('disproven');

    const combinedPositive = new AssumptionSet([
      assume(predicates.nonnegative(x)),
      assume(predicates.nonzero(x))
    ]);
    expect(combinedPositive.ask(predicates.positive(x)).truth).toBe('proven');

    const combinedZero = new AssumptionSet([
      assume(predicates.nonnegative(x)),
      assume(predicates.nonpositive(x))
    ]);
    expect(combinedZero.ask(predicates.zero(x)).truth).toBe('proven');

    const even = new AssumptionSet([assume(predicates.even(x))]);
    expect(even.ask(predicates.integer(x)).truth).toBe('proven');
    expect(even.ask(predicates.odd(x)).truth).toBe('disproven');
  });

  it('propagates negative facts against narrower implications', () => {
    const assumptions = new AssumptionSet([
      assume(predicates.real(x), 'disproven')
    ]);

    expect(assumptions.ask(predicates.integer(x)).truth).toBe('disproven');
    expect(assumptions.ask(predicates.rational(x)).truth).toBe('disproven');
    expect(assumptions.ask(predicates.real(x)).truth).toBe('disproven');
    expect(assumptions.ask(predicates.complex(x)).truth).toBe('unknown');
  });

  it('detects direct, implied, and combined contradictions', () => {
    expect(() => new AssumptionSet([
      assume(predicates.zero(x)),
      assume(predicates.nonzero(x))
    ])).toThrow('Contradictory symbolic assumptions');

    expect(() => new AssumptionSet([
      assume(predicates.positive(x)),
      assume(predicates.nonpositive(x))
    ])).toThrow('Contradictory symbolic assumptions');

    expect(() => new AssumptionSet([
      assume(predicates.even(x)),
      assume(predicates.odd(x))
    ])).toThrow('Contradictory symbolic assumptions');

    expect(() => new AssumptionSet([
      assume(predicates.integer(x)),
      assume(predicates.real(x), 'disproven')
    ])).toThrow('Contradictory symbolic assumptions');

    expect(() => new AssumptionSet([
      assume(predicates.nonnegative(x)),
      assume(predicates.nonzero(x)),
      assume(predicates.positive(x), 'disproven')
    ])).toThrow('Contradictory symbolic assumptions');
  });

  it('extends scopes persistently without changing the parent', () => {
    const empty = new AssumptionSet();
    const real = empty.with(predicates.real(x));
    const positive = real.with(predicates.positive(x));

    expect(empty.size).toBe(0);
    expect(real.size).toBe(1);
    expect(positive.size).toBe(2);
    expect(empty.ask(predicates.real(x)).truth).toBe('unknown');
    expect(real.ask(predicates.positive(x)).truth).toBe('unknown');
    expect(positive.ask(predicates.positive(x)).truth).toBe('proven');
    expect(real.with(predicates.real(x))).toBe(real);
    expect(Object.isFrozen(empty)).toBe(true);
    expect(Object.isFrozen(real.entries())).toBe(true);
    expect(Object.isFrozen(positive.ask(predicates.real(x)))).toBe(true);
    expect(Object.isFrozen(positive.ask(predicates.real(x)).evidence)).toBe(true);
  });

  it('keeps structurally different expressions independent', () => {
    const y = math.symbolic.nodes.symbol('y');
    const assumptions = new AssumptionSet([
      assume(predicates.positive(x))
    ]);

    expect(assumptions.ask(predicates.positive(y)).truth).toBe('unknown');
    expect(assumptions.ask(predicates.positive(math.parse('x + 0'))).truth)
      .toBe('unknown');
  });

  it('validates assumptions and truth values', () => {
    expect(() => new AssumptionSet([
      {predicate: null as never, truth: 'proven'}
    ])).toThrow(TypeError);
    expect(() => assume(predicates.real(x), 'unknown' as never)).toThrow(TypeError);
  });
});
