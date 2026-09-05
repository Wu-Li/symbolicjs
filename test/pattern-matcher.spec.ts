import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import {pattern} from '../src/core/pattern.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

describe('typed pattern matcher', () => {
  it('matches literals, captures, repeated captures, alternatives, and rest operands', () => {
    const math = createMath();
    const x = math.parse('x');

    expect(math.symbolic.match(x, pattern.literal(x))).not.toBeNull();

    const repeated = math.symbolic.match(
      math.parse('x + x'),
      pattern.operator('+', [pattern.capture('term'), pattern.same('term')])
    );
    expect(repeated && repeated.kind !== 'limit').toBe(true);

    const alternative = math.symbolic.match(
      math.parse('sin(x)'),
      pattern.alternative(
        pattern.function('cos', [pattern.capture('arg')]),
        pattern.function('sin', [pattern.capture('arg')])
      )
    );
    expect(alternative && alternative.kind !== 'limit').toBe(true);

    const variadic = math.symbolic.match(
      math.parse('a + b + c'),
      pattern.operator('+', [pattern.capture('head'), pattern.rest('tail')], {
        associative: true
      })
    );
    expect(variadic && variadic.kind !== 'limit').toBe(true);
    if (variadic && variadic.kind !== 'limit') {
      expect(variadic.bindings.rest.tail).toHaveLength(2);
    }
  });

  it('supports dependency and algebraic guards', () => {
    const math = createMath();

    expect(math.symbolic.match(
      math.parse('y + 2'),
      pattern.capture('value', {kind: 'free-of', symbols: ['x']})
    )).not.toBeNull();

    expect(math.symbolic.match(
      math.parse('x + 2'),
      pattern.capture('value', {kind: 'depends-on', symbols: ['x']})
    )).not.toBeNull();

    expect(math.symbolic.match(
      math.parse('3*x + 2'),
      pattern.capture('value', {kind: 'affine-in', generator: 'x'}),
      {domain: 'real', mode: 'conditional'}
    )).not.toBeNull();

    expect(math.symbolic.match(
      math.parse('x^2 + x + 1'),
      pattern.capture('value', {kind: 'polynomial-in', generators: ['x']}),
      {domain: 'real', mode: 'conditional'}
    )).not.toBeNull();
  });

  it('declines unknown semantic guards in strict mode and preserves requirements conditionally', () => {
    const math = createMath();
    const x = math.parse('x');
    const guarded = pattern.capture('x', {
      kind: 'predicate',
      predicate: math.symbolic.predicates.nonzero(x)
    });

    expect(math.symbolic.match(x, guarded, {mode: 'strict'})).toBeNull();

    const conditional = math.symbolic.match(x, guarded, {mode: 'conditional'});
    expect(conditional && conditional.kind !== 'limit').toBe(true);
    if (conditional && conditional.kind !== 'limit') {
      expect(conditional.requirements).toHaveLength(1);
      expect(conditional.bindings.captures.x!.toString()).toBe('x');
      expect(Object.isFrozen(conditional)).toBe(true);
      expect(Object.isFrozen(conditional.bindings.captures)).toBe(true);
    }
  });

  it('produces deterministic commutative bindings across operand permutations', () => {
    const math = createMath();
    const rule = pattern.operator('+', [pattern.capture('left'), pattern.capture('right')], {
      associative: true,
      commutative: true
    });
    const first = math.symbolic.match(math.parse('b + a'), rule, {limits: {matchBranches: 20}});
    const second = math.symbolic.match(math.parse('a + b'), rule, {limits: {matchBranches: 20}});

    expect(first && first.kind !== 'limit').toBe(true);
    expect(second && second.kind !== 'limit').toBe(true);
    if (first && first.kind !== 'limit' && second && second.kind !== 'limit') {
      expect(first.bindings.captures.left!.toString()).toBe(second.bindings.captures.left!.toString());
      expect(first.bindings.captures.right!.toString()).toBe(second.bindings.captures.right!.toString());
    }
  });

  it('returns a typed branch limit instead of partial bindings', () => {
    const math = createMath();
    const result = math.symbolic.match(
      math.parse('a + b + c'),
      pattern.operator('+', [
        pattern.capture('x'),
        pattern.capture('y'),
        pattern.capture('z')
      ], {associative: true, commutative: true}),
      {limits: {matchBranches: 1}}
    );

    expect(result).toEqual({kind: 'limit', limit: 'matchBranches', used: 2, maximum: 1});
  });
});
