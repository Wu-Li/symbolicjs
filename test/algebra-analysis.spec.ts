import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

describe('shared structural algebra analysis', () => {
  it('discovers free symbols through the configured MathJS instance', () => {
    const math = createMath();
    math.import({kappa: 7});
    const expression = math.parse('sin(x) + kappa + b');

    expect(math.symbolic.algebra.freeSymbols(expression)).toEqual(['b', 'x']);
    expect(math.symbolic.algebra.dependsOn(expression, ['x'])).toBe(true);
    expect(math.symbolic.algebra.dependsOn(expression, ['z'])).toBe(false);
    expect(math.symbolic.algebra.occurrenceCount(expression, ['x'])).toBe(1);

    // MathJS can interpret the bare name `b` as a unit during evaluation. In
    // symbolic analysis it remains unresolved unless a scope supplies it.
    expect(math.symbolic.ask(
      math.symbolic.predicates.scalar(math.parse('b')),
      {mode: 'conditional'}
    ).truth).toBe('unknown');
  });

  it('counts overlapping symbol and atom selections once', () => {
    const math = createMath();
    const x = math.parse('x');

    expect(math.symbolic.algebra.occurrenceCount(
      math.parse('x + x^2'),
      ['x'],
      [x]
    )).toBe(2);
  });

  it('does not treat a function callee as a selected expression atom', () => {
    const math = createMath();
    const callee = math.parse('sin');
    const expression = math.parse('sin(x)');

    expect(math.symbolic.algebra.dependsOn(expression, [], [callee])).toBe(false);
    expect(math.symbolic.algebra.occurrenceCount(expression, [], [callee])).toBe(0);
  });

  it('reports selected symbol and atom occurrences with stable inventories', () => {
    const math = createMath();
    const atom = math.parse('sin(x)');
    const expression = math.parse('2*sin(x) + cos(y) + sin(x)');
    const result = math.symbolic.algebra.analyze(expression, {
      symbols: ['x'],
      atoms: [atom],
      domain: 'real'
    });

    expect(result.kind).not.toBe('limit');
    if (result.kind === 'limit') {
      throw new Error('Unexpected algebra analysis limit');
    }
    expect(result.freeSymbols).toEqual(['x', 'y']);
    expect(result.symbolOccurrences).toEqual({x: 2, y: 1});
    expect(result.atomOccurrences).toHaveLength(1);
    expect(result.atomOccurrences[0]!.count).toBe(2);
    expect(result.dependsOnSelection).toBe(true);
    expect(result.targetFree).toBe(false);
    expect(result.constant).toBe(false);
    expect(result.functions).toEqual([
      {name: 'cos', count: 1},
      {name: 'sin', count: 2}
    ]);
    expect(result.operators).toEqual([
      {name: 'add', count: 2},
      {name: 'multiply', count: 1}
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.functions)).toBe(true);
  });

  it('classifies constant expressions and evaluates only resolved scopes', () => {
    const math = createMath();
    math.import({offset: 4});
    const expression = math.parse('x + offset');

    expect(math.symbolic.algebra.evaluate(expression)).toEqual({
      kind: 'unevaluated',
      reason: 'free-symbols',
      freeSymbols: ['x']
    });
    expect(math.symbolic.algebra.evaluate(expression, {scope: {x: 3}})).toEqual({
      kind: 'value',
      value: 7
    });

    const constant = math.symbolic.algebra.analyze(math.parse('pi + 1'));
    expect(constant.kind).not.toBe('limit');
    if (constant.kind === 'limit') {
      throw new Error('Unexpected algebra analysis limit');
    }
    expect(constant.constant).toBe(true);
    expect(constant.evaluation.kind).toBe('value');
  });

  it('includes domain-aware definedness obligations', () => {
    const math = createMath();
    const result = math.symbolic.algebra.analyze(
      math.parse('sqrt(x) / (y - 1)'),
      {domain: 'real'}
    );

    expect(result.kind).not.toBe('limit');
    if (result.kind === 'limit') {
      throw new Error('Unexpected algebra analysis limit');
    }
    expect(result.definedness.map((predicate) =>
      `${predicate.kind}:${predicate.kind === 'property'
        ? predicate.property
        : predicate.domain}:${predicate.expression.toString()}`
    )).toEqual(expect.arrayContaining([
      'property:nonnegative:x',
      'property:nonzero:(y - 1)'
    ]));
  });

  it('returns typed node and depth limits without mutating the input', () => {
    const math = createMath();
    const expression = math.parse('sin(x^2 + y)');
    const before = JSON.stringify(expression);

    expect(math.symbolic.algebra.analyze(expression, {
      algebraLimits: {maximumNodes: 2}
    })).toEqual({kind: 'limit', limit: 'algebraNodes', used: 3, maximum: 2});
    expect(math.symbolic.algebra.analyze(expression, {
      algebraLimits: {maximumDepth: 2}
    })).toEqual({kind: 'limit', limit: 'algebraDepth', used: 3, maximum: 2});
    expect(JSON.stringify(expression)).toBe(before);
  });

  it('validates symbol and atom selections', () => {
    const math = createMath();
    const expression = math.parse('x + 1');

    expect(() => math.symbolic.algebra.analyze(expression, {
      symbols: ['']
    })).toThrow(TypeError);
    expect(() => math.symbolic.algebra.analyze(expression, {
      atoms: [null as never]
    })).toThrow(TypeError);
  });
});
