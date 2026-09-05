import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import {AssumptionSet} from '../src/core/assumptions.js';
import {
  createDefaultSymbolicRegistry,
  SymbolicRegistry
} from '../src/core/registry.js';
import {structuralKey} from '../src/core/structural-key.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

describe('Chapter 5 integration edge contracts', () => {
  it('preserves an assumption set when extending by an empty iterable', () => {
    const set = new AssumptionSet();
    expect(set.withAll([])).toBe(set);
  });

  it('validates operation scopes and limit counters', () => {
    const math = createMath();
    expect(() => math.symbolic.operation({scope: [] as never})).toThrow(TypeError);
    expect(() => math.symbolic.operation({limits: {steps: -1}})).toThrow(RangeError);
    expect(() => math.symbolic.operation({limits: {steps: 1.5}})).toThrow(RangeError);

    const operation = math.symbolic.operation({limits: {steps: 1}});
    expect(operation.consume('missing')).toBeNull();
    expect(operation.usage('missing')).toBe(1);
    expect(() => operation.consume('')).toThrow(TypeError);
  });

  it('covers immutable registry lookup and validation paths', () => {
    const defaults = createDefaultSymbolicRegistry();
    expect(defaults.getOperator('add')).toBeDefined();
    expect(defaults.getFunction('sqrt')).toBeDefined();
    expect(defaults.getOperator('missing')).toBeUndefined();
    expect(defaults.getFunction('missing')).toBeUndefined();

    expect(() => new SymbolicRegistry([null as never], [])).toThrow(TypeError);
    expect(() => new SymbolicRegistry([], [null as never])).toThrow(TypeError);
    expect(() => new SymbolicRegistry([
      {
        name: '', symbol: '+', arities: [2],
        associative: 'never', commutative: 'never', semantic: 'opaque'
      }
    ], [])).toThrow(TypeError);
    expect(() => new SymbolicRegistry([], [
      {name: '', minimumArguments: 1, maximumArguments: 1, semantic: 'opaque'}
    ])).toThrow(TypeError);
  });

  it('rejects cyclic custom-node serialization deterministically', () => {
    const cycle: unknown[] = [];
    cycle.push(cycle);
    const node = {
      isNode: true,
      type: 'CycleNode',
      toJSON: () => cycle
    } as never;

    expect(() => structuralKey(node)).toThrow(/Cyclic array/);
  });

  it('keeps unresolved definedness and scalar judgments conservative', () => {
    const math = createMath();
    const unresolvedRoot = math.symbolic.definedness(
      math.parse('nthRoot(x, n)'),
      {domain: 'real', mode: 'conditional'}
    );
    expect(unresolvedRoot.truth).toBe('unknown');

    expect(math.symbolic.ask(
      math.symbolic.predicates.scalar(math.parse('unknown_name')),
      {mode: 'conditional'}
    ).truth).toBe('unknown');
  });
});
