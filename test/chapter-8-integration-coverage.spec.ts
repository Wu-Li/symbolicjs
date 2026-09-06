import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {
  importsymbolicjs,
  pattern,
  rewriteRule,
  strategy
} from '../src/index.js';
import type {RewriteCostDirection} from '../src/core/rewrite.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

function literalRule(
  math: ReturnType<typeof createMath>,
  id: string,
  from: string,
  to: string,
  costDirection: RewriteCostDirection = 'any'
) {
  return rewriteRule({
    id,
    description: `${from} to ${to}`,
    pattern: pattern.literal(math.parse(from)),
    replace: ({nodes}) => nodes.parse(to),
    costDirection
  });
}

describe('Chapter 8 integration coverage', () => {
  it('validates pattern and rewrite constructors', () => {
    const math = createMath();
    const valid = literalRule(math, 'x-y', 'x', 'y');

    expect(() => pattern.capture('')).toThrow(TypeError);
    expect(() => pattern.same(' ')).toThrow(TypeError);
    expect(() => pattern.rest('')).toThrow(TypeError);
    expect(() => rewriteRule({
      id: '', description: 'bad', pattern: pattern.literal(math.parse('x')),
      replace: ({nodes}) => nodes.symbol('x')
    })).toThrow(TypeError);
    expect(() => rewriteRule({
      id: 'bad', description: '', pattern: pattern.literal(math.parse('x')),
      replace: ({nodes}) => nodes.symbol('x')
    })).toThrow(TypeError);
    expect(() => rewriteRule({
      id: 'bad', description: 'bad', pattern: pattern.literal(math.parse('x')),
      replace: 1 as never
    })).toThrow(TypeError);

    expect(() => strategy.choice()).toThrow(TypeError);
    expect(() => strategy.sequence()).toThrow(TypeError);
    expect(() => strategy.bestOf()).toThrow(TypeError);
    expect(() => strategy.bestFirst()).toThrow(TypeError);
    expect(() => strategy.branch()).toThrow(TypeError);
    expect(strategy.bottomUp(strategy.rule(valid))).toMatchObject({kind: 'bottom-up'});
  });

  it('covers ordered optional and rest matching paths', () => {
    const math = createMath();
    const matcher = pattern.function('f', [
      pattern.capture('first'),
      pattern.optional(pattern.literal(math.parse('b'))),
      pattern.rest('tail')
    ]);

    const absent = math.symbolic.match(math.parse('f(a, c)'), matcher);
    expect(absent && absent.kind !== 'limit').toBe(true);
    if (absent && absent.kind !== 'limit') {
      expect(absent.bindings.captures.first?.toString()).toBe('a');
      expect(absent.bindings.rest.tail?.map((node) => node.toString())).toEqual(['c']);
    }

    const present = math.symbolic.match(math.parse('f(a, b, c)'), matcher);
    expect(present && present.kind !== 'limit').toBe(true);
    if (present && present.kind !== 'limit') {
      expect(present.bindings.rest.tail?.map((node) => node.toString())).toEqual(['c']);
    }

    expect(math.symbolic.match(math.parse('g(a)'), matcher)).toBeNull();
    expect(math.symbolic.match(
      math.parse('a + b'),
      pattern.operator('*', [pattern.capture('a'), pattern.capture('b')])
    )).toBeNull();
    expect(math.symbolic.match(
      math.parse('x + y'),
      pattern.operator('+', [pattern.capture('term'), pattern.same('term')])
    )).toBeNull();
    expect(math.symbolic.match(math.parse('(x)'), pattern.literal(math.parse('x')))).not.toBeNull();
  });

  it('covers algebraic guard success and failure paths', () => {
    const math = createMath();

    expect(math.symbolic.match(
      math.parse('(x + 1) / (x - 1)'),
      pattern.capture('value', {kind: 'rational-in', generators: ['x']}),
      {domain: 'real', mode: 'conditional'}
    )).not.toBeNull();
    expect(math.symbolic.match(
      math.parse('x'),
      pattern.capture('value', {kind: 'free-of', symbols: ['x']})
    )).toBeNull();
    expect(math.symbolic.match(
      math.parse('y'),
      pattern.capture('value', {kind: 'depends-on', symbols: ['x']})
    )).toBeNull();
    expect(math.symbolic.match(
      math.parse('x^2'),
      pattern.capture('value', {kind: 'affine-in', generator: 'x'}),
      {domain: 'real', mode: 'conditional'}
    )).toBeNull();
    expect(math.symbolic.match(
      math.parse('sin(x)'),
      pattern.capture('value', {kind: 'polynomial-in', generators: ['x']}),
      {domain: 'real', mode: 'conditional'}
    )).toBeNull();
    expect(math.symbolic.match(
      math.parse('sin(x)'),
      pattern.capture('value', {kind: 'rational-in', generators: ['x']}),
      {domain: 'real', mode: 'conditional'}
    )).toBeNull();

    expect(math.symbolic.match(
      math.parse('2'),
      pattern.capture('value', {
        kind: 'predicate',
        predicate: math.symbolic.predicates.nonzero(math.parse('2'))
      }),
      {domain: 'real'}
    )).not.toBeNull();
    expect(math.symbolic.match(
      math.parse('0'),
      pattern.capture('value', {
        kind: 'predicate',
        predicate: math.symbolic.predicates.nonzero(math.parse('0'))
      }),
      {domain: 'real'}
    )).toBeNull();
  });

  it('covers commutative optional and rest matching', () => {
    const math = createMath();
    const match = math.symbolic.match(
      math.parse('a + b + 0'),
      pattern.operator('+', [
        pattern.capture('head'),
        pattern.optional(pattern.literal(math.parse('0'))),
        pattern.rest('tail')
      ], {associative: true, commutative: true}),
      {limits: {matchBranches: 50}}
    );

    expect(match && match.kind !== 'limit').toBe(true);
    if (match && match.kind !== 'limit') {
      expect(match.bindings.captures.head).toBeDefined();
      expect(match.bindings.rest.tail).toBeDefined();
    }
  });

  it('covers sequence, bottom-up, and choice strategies', () => {
    const math = createMath();
    const xToY = literalRule(math, 'x-y', 'x', 'y');
    const yToZ = literalRule(math, 'y-z', 'y', 'z');
    const noMatch = literalRule(math, 'q-r', 'q', 'r');
    const addZero = rewriteRule({
      id: 'add-zero',
      description: 'remove zero',
      pattern: pattern.operator('+', [pattern.capture('value'), pattern.literal(math.parse('0'))]),
      replace: ({bindings}) => bindings.captures.value!,
      costDirection: 'decrease'
    });

    expect(math.symbolic.rewriteExpression(
      math.parse('x'),
      strategy.sequence(strategy.rule(xToY), strategy.rule(yToZ))
    ).node.toString()).toBe('z');

    expect(math.symbolic.rewriteExpression(
      math.parse('sin(x + 0)'),
      strategy.bottomUp(strategy.rule(addZero))
    ).node.toString()).toBe('sin(x)');

    expect(math.symbolic.rewriteExpression(
      math.parse('x'),
      strategy.choice(strategy.rule(noMatch), strategy.rule(xToY))
    ).node.toString()).toBe('y');
  });

  it('covers rewrite state, branch, frontier, and matcher limits', () => {
    const math = createMath();
    const xToY = literalRule(math, 'x-y', 'x', 'y');
    const xToZ = literalRule(math, 'x-z', 'x', 'z');
    const noMatch = literalRule(math, 'q-r', 'q', 'r');

    expect(math.symbolic.rewriteExpression(
      math.parse('x'), strategy.rule(xToY), {maximumStates: 1}
    ).limit).toMatchObject({limit: 'rewriteStates'});

    expect(math.symbolic.rewriteExpression(
      math.parse('x'),
      strategy.choice(strategy.rule(noMatch), strategy.rule(xToY)),
      {maximumBranches: 1}
    ).limit).toMatchObject({limit: 'rewriteBranches'});

    expect(math.symbolic.rewriteExpression(
      math.parse('x'),
      strategy.branch(strategy.rule(xToY), strategy.rule(xToZ)),
      {maximumFrontier: 1}
    ).limit).toMatchObject({limit: 'rewriteFrontier'});

    const acRule = rewriteRule({
      id: 'ac-limit',
      description: 'force matcher branch limit',
      pattern: pattern.operator('+', [
        pattern.capture('a'), pattern.capture('b'), pattern.capture('c')
      ], {associative: true, commutative: true}),
      replace: ({nodes}) => nodes.constant(0)
    });
    expect(math.symbolic.rewriteExpression(
      math.parse('a + b + c'), strategy.rule(acRule), {maximumBranches: 1}
    ).limit).toMatchObject({limit: 'rewriteBranches'});
  });

  it('covers rewrite replacement and cost rejection paths', () => {
    const math = createMath();
    const same = literalRule(math, 'same', 'x', 'x');
    const increase = literalRule(math, 'increase', 'x', 'x + 0', 'decrease');
    const equalCostDecrease = literalRule(math, 'equal-decrease', 'x', 'y', 'decrease');
    const equalCostNonincrease = literalRule(math, 'equal-nonincrease', 'x', 'y', 'nonincrease');

    expect(math.symbolic.rewriteExpression(math.parse('x'), strategy.rule(same)).changed).toBe(false);
    expect(math.symbolic.rewriteExpression(math.parse('x'), strategy.rule(increase)).changed).toBe(false);
    expect(math.symbolic.rewriteExpression(math.parse('x'), strategy.rule(equalCostDecrease)).changed).toBe(false);
    expect(math.symbolic.rewriteExpression(math.parse('x'), strategy.rule(equalCostNonincrease)).node.toString()).toBe('y');

    const bad = rewriteRule({
      id: 'bad-result',
      description: 'return a non-node',
      pattern: pattern.literal(math.parse('x')),
      replace: () => 1 as never
    });
    expect(() => math.symbolic.rewriteExpression(math.parse('x'), strategy.rule(bad))).toThrow(TypeError);
    expect(() => math.symbolic.rewriteExpression(null as never, strategy.rule(same))).toThrow(TypeError);
  });

  it('covers best-first and empty-result best-of behavior', () => {
    const math = createMath();
    const noMatchA = literalRule(math, 'a', 'q', 'r');
    const noMatchB = literalRule(math, 'b', 'w', 'v');
    const grow = literalRule(math, 'grow', 'x', 'x + 0');

    expect(math.symbolic.rewriteExpression(
      math.parse('x'),
      strategy.bestOf(strategy.rule(noMatchA), strategy.rule(noMatchB))
    ).changed).toBe(false);

    const bestFirst = math.symbolic.rewriteExpression(
      math.parse('x'),
      strategy.bestFirst(strategy.rule(grow))
    );
    expect(bestFirst.changed).toBe(false);
    expect(bestFirst.node.toString()).toBe('x');
  });

  it('rejects invalid rewrite budgets', () => {
    const math = createMath();
    const rule = literalRule(math, 'x-y', 'x', 'y');
    for (const options of [
      {maximumSteps: 0},
      {maximumBranches: 0},
      {maximumStates: 0},
      {maximumFrontier: 0},
      {maximumNodeGrowth: 0}
    ]) {
      expect(() => math.symbolic.rewriteExpression(
        math.parse('x'), strategy.rule(rule), options
      )).toThrow(RangeError);
    }
  });
});
