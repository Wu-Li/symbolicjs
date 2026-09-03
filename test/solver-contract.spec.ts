import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {SolverContext, resolveLimits} from '../src/budget.js';
import {
  DEFAULT_SOLVER_LIMITS,
  equationSymbols,
  importsymbolicjs
} from '../src/index.js';
import type {LimitKind, SolverLimits} from '../src/index.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

describe('equationSymbols', () => {
  it('discovers free symbols on both sides in stable order', () => {
    const math = createMath();
    const equation = math.parseEquation(
      'sin(x) + pi + a.b =:= f(y) + e + z'
    );

    expect(math.equationSymbols(equation)).toEqual(['a', 'x', 'y', 'z']);
    expect(equationSymbols(equation)).toEqual(['a', 'x', 'y', 'z']);
    expect(Object.isFrozen(math.equationSymbols(equation))).toBe(true);
  });

  it('returns no symbols for a constant equality', () => {
    const math = createMath();

    expect(math.equationSymbols(math.parseEquation('2 =:= sqrt(4)')))
      .toEqual([]);
  });

  it('rejects non-equations', () => {
    const math = createMath();

    expect(() => equationSymbols(math.parse('x + 1') as never))
      .toThrow('EqualityNode expected');
  });
});

describe('solver budgets', () => {
  it('resolves frozen defaults and validated overrides', () => {
    expect(resolveLimits()).toEqual(DEFAULT_SOLVER_LIMITS);
    const limits = resolveLimits({limits: {branches: 2}});

    expect(limits.branches).toBe(2);
    expect(limits.inputNodes).toBe(DEFAULT_SOLVER_LIMITS.inputNodes);
    expect(Object.isFrozen(limits)).toBe(true);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid limit %s',
    (value) => {
      expect(() => resolveLimits({limits: {branches: value}})).toThrow(
        RangeError
      );
    }
  );

  it('enforces the input-node preflight limit', () => {
    const math = createMath();
    const context = new SolverContext('x', {limits: {inputNodes: 2}});

    expect(context.preflight(math.parse('x + 1'))).toEqual({
      kind: 'limit',
      target: 'x',
      limit: 'input-nodes'
    });
    expect(new SolverContext('x').preflight(math.parse('x + 1'))).toBeNull();
  });

  it.each<[
    Exclude<LimitKind, 'input-nodes'>,
    keyof SolverLimits
  ]>([
    ['rewrite-steps', 'rewriteSteps'],
    ['recursion-depth', 'recursionDepth'],
    ['branches', 'branches'],
    ['candidates', 'candidates'],
    ['numeric-iterations', 'numericIterations'],
    ['total-work', 'totalWork']
  ])('enforces the %s budget', (kind, property) => {
    const context = new SolverContext('x', {limits: {[property]: 1}});

    expect(context.consume(kind)).toBeNull();
    expect(context.consume(kind)).toEqual({kind: 'limit', target: 'x', limit: kind});
    expect(Object.isFrozen(context.consume(kind))).toBe(true);
  });

  it('rejects invalid consumption amounts', () => {
    const context = new SolverContext('x');

    expect(() => context.consume('branches', -1)).toThrow(RangeError);
  });
});

describe('solveEquation contract shell', () => {
  it('accepts strings and nodes and returns a typed unsupported result', () => {
    const math = createMath();
    const fromString = math.solveEquation('x + 1 =:= 3', 'x');
    const fromNode = math.solveEquation(math.parseEquation('x =:= y'), 'y');

    expect(fromString).toEqual({kind: 'unsupported', target: 'x', reason: 'no-rule'});
    expect(fromNode).toEqual({kind: 'unsupported', target: 'y', reason: 'no-rule'});
    expect(Object.isFrozen(fromString)).toBe(true);
  });

  it('classifies a target not present in the equation', () => {
    const math = createMath();

    expect(math.solveEquation('x =:= 1', 'y')).toEqual({
      kind: 'unsupported',
      target: 'y',
      reason: 'invalid-target'
    });
  });

  it('returns an input limit before dispatch', () => {
    const math = createMath();

    expect(math.solveEquation('x + 1 =:= 3', 'x', {limits: {inputNodes: 2}}))
      .toEqual({kind: 'limit', target: 'x', limit: 'input-nodes'});
  });

  it.each(['', ' x', 'x ', 3])('rejects invalid target %j', (target) => {
    const math = createMath();

    expect(() => math.solveEquation('x =:= 1', target as string))
      .toThrow('Target must be a nonempty, trimmed symbol name');
  });

  it('rejects a non-equation node', () => {
    const math = createMath();

    expect(() => math.solveEquation(math.parse('x + 1') as never, 'x'))
      .toThrow('EqualityNode or equation string expected');
  });
});
