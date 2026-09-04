import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {all, create} from 'mathjs';
import {describe, expect, it, vi} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import type {EqualityNode, symbolicjsInstance} from '../src/index.js';
import {OperationBudget} from '../src/core/operation-context.js';
import {SYMBOLIC_MATHJS_DEPENDENCIES} from '../src/core/symbolic-context.js';

interface ChapterMetrics {
  readonly schemaVersion: number;
  readonly sourceCommit: string;
  readonly package: {readonly packedBytes: number; readonly unpackedBytes: number};
  readonly productionJavaScriptBytes: Readonly<Record<string, number>>;
  readonly baselineComparison: {
    readonly packedBytes: number;
    readonly unpackedBytes: number;
    readonly productionJavaScriptBytes: number;
  };
}

function createMath(config?: Parameters<typeof create>[1]): symbolicjsInstance {
  return importsymbolicjs(create(all!, config));
}

describe('MathJS-native symbolic substrate', () => {
  it('keeps adapter namespaces and registries isolated by MathJS instance', () => {
    const first = createMath();
    const second = createMath();
    const firstSymbolic = first.symbolic;

    first.import({
      localConstant: 2,
      localFunction: (value: number) => value + 1
    });
    second.import({localConstant: 7});

    expect(firstSymbolic.math.lookup('localConstant')).toBe(2);
    expect(firstSymbolic.math.lookup('localFunction')).toBeTypeOf('function');
    expect(second.symbolic.math.lookup('localConstant')).toBe(7);
    expect(second.symbolic.math.lookup('localFunction')).toBeUndefined();
    expect(firstSymbolic).not.toBe(second.symbolic);
    expect(firstSymbolic.registry).not.toBe(second.symbolic.registry);

    const extendedRegistry = firstSymbolic.registry.withFunction({
      name: 'localFunction',
      minimumArguments: 1,
      maximumArguments: 1
    });
    const extended = firstSymbolic.with({registry: extendedRegistry});

    expect(extended.registry.getFunction('localFunction')).toBeDefined();
    expect(firstSymbolic.registry.getFunction('localFunction')).toBeUndefined();
    expect(second.symbolic.registry.getFunction('localFunction')).toBeUndefined();
    expect(Object.isFrozen(firstSymbolic)).toBe(true);
    expect(Object.isFrozen(firstSymbolic.registry)).toBe(true);
  });

  it('builds and revives nodes through the configured instance without mutating inputs', () => {
    const math = createMath();
    const builder = math.symbolic.nodes;
    const x = builder.symbol('x');
    const two = builder.constant(2);
    const args = [x, two];
    const sum = builder.operator('+', 'add', args);
    const squareRoot = builder.call('sqrt', [builder.constant(9)]);
    const equation = builder.equality(sum, builder.constant(5));

    args[0] = builder.constant(100);

    expect(x instanceof math.SymbolNode).toBe(true);
    expect(sum instanceof math.OperatorNode).toBe(true);
    expect(equation instanceof math.EqualityNode).toBe(true);
    expect(sum.compile().evaluate({x: 3})).toBe(5);
    expect(squareRoot.compile().evaluate()).toBe(3);
    expect(equation.compile().evaluate({x: 3})).toBe(true);
    expect(sum.toString()).toBe('x + 2');

    const restored = math.symbolic.math.revive<EqualityNode>(
      JSON.stringify(equation)
    );
    expect(restored.isEqualityNode).toBe(true);
    expect(restored.equals(equation)).toBe(true);
    expect(restored instanceof math.EqualityNode).toBe(true);
  });

  it('supports configured scalar values without crossing number configurations', () => {
    const normal = createMath();
    const big = createMath({number: 'BigNumber'});
    const fraction = createMath({number: 'Fraction'});
    const complex = createMath();

    const normalValue = normal.symbolic.nodes.parse('1 / 3').compile().evaluate();
    const bigValue = big.symbolic.nodes.constant(big.bignumber(2)).compile().evaluate();
    const fractionValue = fraction.symbolic.nodes
      .constant(fraction.fraction(1, 3))
      .compile()
      .evaluate();
    const complexValue = complex.symbolic.nodes
      .constant(complex.complex(1, 2))
      .compile()
      .evaluate();

    expect(typeof normalValue).toBe('number');
    expect(big.isBigNumber(bigValue)).toBe(true);
    expect(fraction.isFraction(fractionValue)).toBe(true);
    expect(complex.isComplex(complexValue)).toBe(true);
    expect(normal.symbolic.registry).not.toBe(big.symbolic.registry);
    expect(big.symbolic.registry).not.toBe(fraction.symbolic.registry);
    expect(fraction.symbolic.registry).not.toBe(complex.symbolic.registry);
  });

  it('defines the supported MathJS factory dependency boundary explicitly', () => {
    expect(SYMBOLIC_MATHJS_DEPENDENCIES).toEqual([
      'ConstantNode',
      'EqualityNode',
      'FunctionNode',
      'OperatorNode',
      'SymbolNode',
      'mathWithTransform',
      'parse',
      'reviver'
    ]);
    expect(Object.isFrozen(SYMBOLIC_MATHJS_DEPENDENCIES)).toBe(true);
  });

  it('retains existing solver behavior beside the new symbolic service', () => {
    const math = createMath();

    expect(math.symbolic).toBeDefined();
    expect(math.symbolicKernel).toBeDefined();
    const result = math.solveEquation('x + 1 =:= 3', 'x');
    expect(result.kind).toBe('finite');
    if (result.kind === 'finite') {
      expect(result.solutions[0]?.value.compile().evaluate()).toBe(2);
    }
  });
});

describe('symbolic registry', () => {
  it('contains conservative built-in operator and function metadata', () => {
    const registry = createMath().symbolic.registry;

    expect(registry.getOperator('add')).toEqual({
      name: 'add',
      symbol: '+',
      arities: [2],
      commutative: 'scalar',
      associative: 'scalar'
    });
    expect(registry.getOperator('divide')?.commutative).toBe('never');
    expect(registry.getFunction('log')).toEqual({
      name: 'log',
      minimumArguments: 1,
      maximumArguments: 2
    });
    expect(registry.getFunction('unknown')).toBeUndefined();
    expect(registry.operatorNames()).toEqual([
      'add', 'divide', 'multiply', 'pow', 'subtract', 'unaryMinus'
    ]);
    expect(registry.functionNames()).toContain('nthRoot');
    expect(Object.isFrozen(registry.getOperator('add')?.arities)).toBe(true);
  });

  it('creates persistent replacements and rejects malformed metadata', () => {
    const registry = createMath().symbolic.registry;
    const replaced = registry.withOperator({
      name: 'add',
      symbol: '+',
      arities: [2, 3],
      commutative: 'scalar',
      associative: 'scalar'
    });

    expect(replaced.getOperator('add')?.arities).toEqual([2, 3]);
    expect(registry.getOperator('add')?.arities).toEqual([2]);
    expect(() => registry.withFunction({
      name: 'bad',
      minimumArguments: 2,
      maximumArguments: 1
    })).toThrow(RangeError);
    expect(() => registry.withOperator({
      name: '',
      symbol: '+',
      arities: [2],
      commutative: 'scalar',
      associative: 'scalar'
    })).toThrow(TypeError);
  });
});

describe('operation-neutral contexts and budgets', () => {
  it('enforces independent deterministic limits', () => {
    const context = createMath().symbolic.operation({
      limits: {steps: 1, branches: 2}
    });

    expect(context.consume('steps')).toBeNull();
    expect(context.consume('branches', 2)).toBeNull();
    expect(context.consume('steps')).toEqual({
      kind: 'limit', limit: 'steps', used: 2, maximum: 1
    });
    expect(context.consume('branches')).toEqual({
      kind: 'limit', limit: 'branches', used: 3, maximum: 2
    });
    expect(context.usageSnapshot()).toEqual({branches: 3, steps: 2});
    expect(context.check('steps', 1)).toBeNull();
    expect(context.check('steps', 2)).toEqual({
      kind: 'limit', limit: 'steps', used: 2, maximum: 1
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.limits)).toBe(true);
    expect(Object.isFrozen(context.usageSnapshot())).toBe(true);

    const fresh = createMath().symbolic.operation({limits: {steps: 1}});
    expect(fresh.consume('steps')).toBeNull();
    expect(fresh.usage('steps')).toBe(1);
  });

  it('validates generic budgets and consumption amounts', () => {
    expect(() => new OperationBudget({steps: -1})).toThrow(RangeError);
    const budget = new OperationBudget({steps: 1});

    expect(() => budget.consume('', 1)).toThrow(TypeError);
    expect(() => budget.consume('steps', 1.5)).toThrow(RangeError);
    expect(() => budget.check('steps', -1)).toThrow(RangeError);
    expect(budget.consume('unlimited', 10_000)).toBeNull();
  });

  it('keeps memoization, assumptions, and diagnostics operation-local', () => {
    const math = createMath();
    const node = math.parse('x + 1');
    const createValue = vi.fn(() => ({value: 1}));
    const quiet = math.symbolic.operation();
    const traced = quiet.with({
      assumptions: {x: 'real'},
      domain: 'real',
      limits: {steps: 3},
      mode: 'conditional',
      diagnostics: true
    });

    expect(quiet.memoize(node, 'analysis', createValue))
      .toBe(quiet.memoize(node, 'analysis', createValue));
    expect(createValue).toHaveBeenCalledTimes(1);
    traced.memoize(node, 'analysis', createValue);
    expect(createValue).toHaveBeenCalledTimes(2);

    quiet.trace({stage: 'analysis', rule: 'ignored'});
    traced.trace({stage: 'analysis', rule: 'classified', outcome: 'real'});

    expect(quiet.traceSnapshot()).toEqual([]);
    expect(traced.traceSnapshot()).toEqual([
      {stage: 'analysis', rule: 'classified', outcome: 'real'}
    ]);
    expect(Object.isFrozen(traced.traceSnapshot())).toBe(true);
    expect(traced.assumptions).toEqual({x: 'real'});
    expect(traced.domain).toBe('real');
    expect(traced.mode).toBe('conditional');
    expect(traced.limits.steps).toBe(3);
    expect(quiet.assumptions).toEqual({});
    expect(quiet.domain).toBe('unknown');
    expect(Object.isFrozen(traced.assumptions)).toBe(true);
  });

  it('applies immutable SymbolicContext operation defaults', () => {
    const symbolic = createMath().symbolic;
    const configured = symbolic.with({
      operationDefaults: {
        assumptions: {n: 'integer'},
        domain: 'real',
        limits: {work: 2},
        mode: 'conditional',
        diagnostics: true
      }
    });
    const operation = configured.operation({limits: {branches: 1}});

    expect(operation.assumptions).toEqual({n: 'integer'});
    expect(operation.domain).toBe('real');
    expect(operation.mode).toBe('conditional');
    expect(operation.diagnostics).toBe(true);
    expect(operation.limits).toEqual({branches: 1, work: 2});
    expect(symbolic.operation().domain).toBe('unknown');
  });
});

describe('node builder validation', () => {
  it('rejects invalid names, nodes, sources, and serialized values', () => {
    const symbolic = createMath().symbolic;

    expect(() => symbolic.nodes.symbol('')).toThrow(TypeError);
    expect(() => symbolic.nodes.operator('', 'add', [])).toThrow(TypeError);
    expect(() => symbolic.nodes.operator('+', 'add', [null as never]))
      .toThrow(TypeError);
    expect(() => symbolic.nodes.call('', [])).toThrow(TypeError);
    expect(() => symbolic.math.parse(1 as never)).toThrow(TypeError);
    expect(() => symbolic.math.revive(null as never)).toThrow(TypeError);
    expect(symbolic.math.has('definitelyMissing')).toBe(false);
  });
});

describe('Chapter 1 package measurements', () => {
  it('records the candidate package and production JavaScript delta', () => {
    const metrics = JSON.parse(readFileSync(resolve(
      import.meta.dirname,
      'fixtures/architecture-migration-chapter-1-metrics.json'
    ), 'utf8')) as ChapterMetrics;

    expect(metrics.schemaVersion).toBe(1);
    expect(metrics.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(metrics.package.packedBytes).toBeGreaterThan(0);
    expect(metrics.package.unpackedBytes).toBeGreaterThan(metrics.package.packedBytes);
    expect(metrics.productionJavaScriptBytes['core/symbolic-context.js']).toBeGreaterThan(0);
    expect(metrics.productionJavaScriptBytes['core/operation-context.js']).toBeGreaterThan(0);
    expect(metrics.baselineComparison.productionJavaScriptBytes).toBeGreaterThan(0);
  });
});
