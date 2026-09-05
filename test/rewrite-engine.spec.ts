import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {
  importsymbolicjs,
  pattern,
  rewriteRule,
  strategy
} from '../src/index.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

describe('bounded rewrite strategies', () => {
  it('applies typed local rules without mutating the input', () => {
    const math = createMath();
    const input = math.parse('x + 0');
    const before = input.toString();
    const addZero = rewriteRule({
      id: 'add-zero',
      description: 'Remove an additive zero',
      pattern: pattern.operator('+', [
        pattern.capture('value'),
        pattern.literal(math.parse('0'))
      ]),
      replace: ({bindings}) => bindings.captures.value!,
      costDirection: 'decrease'
    });

    const result = math.symbolic.transform(input, strategy.rule(addZero));

    expect(result.changed).toBe(true);
    expect(result.node.toString()).toBe('x');
    expect(input.toString()).toBe(before);
    expect(result.trace.map((step) => step.rule)).toEqual(['add-zero']);
  });

  it('traverses nested expressions top-down and repeats to a fixed point', () => {
    const math = createMath();
    const addZero = rewriteRule({
      id: 'add-zero',
      description: 'Remove an additive zero',
      pattern: pattern.operator('+', [
        pattern.capture('value'),
        pattern.literal(math.parse('0'))
      ]),
      replace: ({bindings}) => bindings.captures.value!,
      costDirection: 'decrease'
    });

    const result = math.symbolic.transform(
      math.parse('sin((x + 0) + 0)'),
      strategy.repeat(strategy.topDown(strategy.rule(addZero)))
    );

    expect(result.limit).toBeUndefined();
    expect(result.node.toString()).toBe('sin(x)');
    expect(result.trace).toHaveLength(2);
  });

  it('preserves conditional requirements produced by matcher guards', () => {
    const math = createMath();
    const x = math.parse('x');
    const cancelSelf = rewriteRule({
      id: 'cancel-self',
      description: 'Cancel equal numerator and denominator when nonzero',
      pattern: pattern.operator('/', [
        pattern.capture('value', {
          kind: 'predicate',
          predicate: math.symbolic.predicates.nonzero(x)
        }),
        pattern.same('value')
      ]),
      replace: ({nodes}) => nodes.constant(1)
    });

    expect(math.symbolic.transform(
      math.parse('x / x'),
      strategy.rule(cancelSelf),
      {mode: 'strict'}
    ).changed).toBe(false);

    const conditional = math.symbolic.transform(
      math.parse('x / x'),
      strategy.rule(cancelSelf),
      {mode: 'conditional'}
    );
    expect(conditional.changed).toBe(true);
    expect(conditional.requirements).toHaveLength(1);
    expect(conditional.requirements[0]).toMatchObject({kind: 'property', property: 'nonzero'});
  });

  it('chooses the lower-cost result deterministically', () => {
    const math = createMath();
    const source = pattern.literal(math.parse('x'));
    const toSimple = rewriteRule({
      id: 'to-simple',
      description: 'Build a small result',
      pattern: source,
      replace: ({nodes}) => nodes.symbol('y')
    });
    const toLarger = rewriteRule({
      id: 'to-larger',
      description: 'Build a larger result',
      pattern: source,
      replace: ({nodes}) => nodes.parse('y + 0')
    });

    const result = math.symbolic.transform(
      math.parse('x'),
      strategy.bestOf(strategy.rule(toLarger), strategy.rule(toSimple))
    );

    expect(result.node.toString()).toBe('y');
    expect(result.trace[0]?.rule).toBe('to-simple');
  });

  it('terminates deliberate inverse-rule cycles by visited structural state', () => {
    const math = createMath();
    const xToY = rewriteRule({
      id: 'x-to-y',
      description: 'Cycle test forward rule',
      pattern: pattern.literal(math.parse('x')),
      replace: ({nodes}) => nodes.symbol('y')
    });
    const yToX = rewriteRule({
      id: 'y-to-x',
      description: 'Cycle test reverse rule',
      pattern: pattern.literal(math.parse('y')),
      replace: ({nodes}) => nodes.symbol('x')
    });

    const result = math.symbolic.transform(
      math.parse('x'),
      strategy.repeat(strategy.choice(strategy.rule(xToY), strategy.rule(yToX)))
    );

    expect(result.limit).toBeUndefined();
    expect(result.node.toString()).toBe('y');
  });

  it('returns typed limits when rewrite work is exhausted', () => {
    const math = createMath();
    const xToY = rewriteRule({
      id: 'x-to-y',
      description: 'Budget test rule',
      pattern: pattern.literal(math.parse('x')),
      replace: ({nodes}) => nodes.symbol('y')
    });

    const result = math.symbolic.transform(
      math.parse('x'),
      strategy.repeat(strategy.rule(xToY)),
      {maximumSteps: 1}
    );

    expect(result.changed).toBe(true);
    expect(result.limit).toMatchObject({kind: 'limit', limit: 'rewriteSteps'});
  });

  it('enforces node-growth budgets on expanding replacements', () => {
    const math = createMath();
    const expand = rewriteRule({
      id: 'expand-x',
      description: 'Growth budget test rule',
      pattern: pattern.literal(math.parse('x')),
      replace: ({nodes}) => nodes.parse('x + x + x')
    });

    const result = math.symbolic.transform(
      math.parse('x'),
      strategy.rule(expand),
      {maximumNodeGrowth: 1}
    );

    expect(result.changed).toBe(true);
    expect(result.limit).toMatchObject({kind: 'limit', limit: 'rewriteNodeGrowth'});
  });
});
