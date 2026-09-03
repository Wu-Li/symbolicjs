import {all, create} from 'mathjs';
import {describe, expect, it, vi} from 'vitest';
import {importsymbolicjs, ReadonlyResultMap} from '../src/index.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

describe('solveEquationForAll', () => {
  it('solves independently for every member symbol in stable order', () => {
    const math = createMath();
    const results = math.solveEquationForAll('a*x + b =:= 0');

    expect([...results.keys()]).toEqual(['a', 'b', 'x']);
    expect([...results.values()].every((result) =>
      result.kind === 'finite' || result.kind === 'partial'
    )).toBe(true);
    for (const [target, result] of results) {
      expect(result.kind).toBe(math.solveEquation('a*x + b =:= 0', target).kind);
    }
  });

  it('keeps one target limit from suppressing another target', () => {
    const math = createMath();
    const results = math.solveEquationForAll('x^2 + y =:= 0', {
      limits: {branches: 0}
    });

    expect(results.get('x')).toEqual({kind: 'limit', target: 'x', limit: 'branches'});
    expect(['finite', 'partial']).toContain(results.get('y')?.kind);
  });

  it('returns finite and parametric conditional results by target', () => {
    const math = createMath();
    const results = math.solveEquationForAll('x*x + sin(y) =:= 0');

    expect(results.get('x')?.kind).toBe('partial');
    expect(results.get('y')?.kind).toBe('parametric');
  });

  it('returns an immutable empty map for a constant equation', () => {
    const math = createMath();
    const results = math.solveEquationForAll('1 =:= 1');

    expect(results.size).toBe(0);
    expect(Object.isFrozen(results)).toBe(true);
    expect((results as unknown as {set?: unknown}).set).toBeUndefined();
    expect(Object.prototype.toString.call(results)).toBe('[object ReadonlyResultMap]');
  });

  it('accepts equation nodes and rejects other nodes', () => {
    const math = createMath();

    expect(math.solveEquationForAll(math.parseEquation('x =:= 1')).has('x'))
      .toBe(true);
    expect(() => math.solveEquationForAll(math.parse('x + 1') as never))
      .toThrow('EqualityNode or equation string expected');
  });
});

describe('ReadonlyResultMap', () => {
  it('implements the complete ReadonlyMap iteration surface', () => {
    const map = new ReadonlyResultMap([['a', 1], ['b', 2]]);
    const callback = vi.fn();
    const thisArg = {};

    map.forEach(callback, thisArg);
    expect(map.size).toBe(2);
    expect(map.get('a')).toBe(1);
    expect(map.get('missing')).toBeUndefined();
    expect(map.has('b')).toBe(true);
    expect([...map]).toEqual([['a', 1], ['b', 2]]);
    expect([...map.entries()]).toEqual([['a', 1], ['b', 2]]);
    expect([...map.keys()]).toEqual(['a', 'b']);
    expect([...map.values()]).toEqual([1, 2]);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback.mock.instances).toEqual([thisArg, thisArg]);
  });
});

describe('solver diagnostics', () => {
  it('is absent by default', () => {
    const math = createMath();

    expect(math.solveEquation('x + 1 =:= 2', 'x').diagnostics).toBeUndefined();
  });

  it('records analysis, dispatch, verification, and result classification', () => {
    const math = createMath();
    const result = math.solveEquation('x*x - 1 =:= 0', 'x', {
      diagnostics: true
    });
    const diagnostics = result.diagnostics!;

    expect(diagnostics.steps.map((step) => step.stage)).toEqual([
      'analysis',
      'dispatch',
      'dispatch',
      'dispatch',
      'verification',
      'verification',
      'result'
    ]);
    expect(diagnostics.steps[2]?.rule).toBe('trigonometric');
    expect(diagnostics.steps[3]?.rule).toBe('rational-polynomial');
    expect(diagnostics.steps[4]?.expression).toContain('x = ');
    expect(diagnostics.steps.at(-1)?.outcome).toBe('finite');
    expect(Object.isFrozen(diagnostics)).toBe(true);
    expect(Object.isFrozen(diagnostics.steps)).toBe(true);
    expect(diagnostics.steps.every(Object.isFrozen)).toBe(true);
  });

  it('identifies numeric cubic dispatch and traces early outcomes', () => {
    const math = createMath();
    const cubic = math.solveEquation('x*x*x - x =:= 0', 'x', {
      diagnostics: true
    });
    const invalid = math.solveEquation('x =:= 1', 'y', {diagnostics: true});
    const limited = math.solveEquation('x + 1 =:= 2', 'x', {
      diagnostics: true,
      limits: {inputNodes: 0}
    });

    expect(cubic.diagnostics?.steps.some((step) => step.rule === 'numeric-cubic'))
      .toBe(true);
    expect(invalid.diagnostics?.steps.at(-1)?.outcome).toBe('unsupported');
    expect(limited.diagnostics?.steps.at(-1)?.outcome).toBe('limit');
  });
});
