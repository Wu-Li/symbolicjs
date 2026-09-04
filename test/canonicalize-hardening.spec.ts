import {all, create, isConstantNode} from 'mathjs';
import type {MathNode} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import type {symbolicjsInstance} from '../src/types.js';

function createMath(config?: Parameters<typeof create>[1]): symbolicjsInstance {
  return importsymbolicjs(config === undefined
    ? create(all!)
    : create(all!, config));
}

function opaqueNode({
  type = 'OpaqueNode',
  json = {mathjs: type},
  children = [],
  map
}: {
  readonly type?: string;
  readonly json?: unknown;
  readonly children?: readonly MathNode[];
  readonly map?: (
    callback: (node: MathNode, path: string, parent: MathNode) => MathNode,
    parent: MathNode
  ) => MathNode;
} = {}): MathNode {
  const node: Record<string, unknown> = {
    type,
    isNode: true,
    toJSON: () => json,
    toString: () => type,
    forEach(callback: (child: MathNode, path: string, parent: MathNode) => void) {
      children.forEach((child, index) =>
        callback(child, String(index), node as unknown as MathNode)
      );
    },
    map(callback: (child: MathNode, path: string, parent: MathNode) => MathNode) {
      return map
        ? map(callback, node as unknown as MathNode)
        : node as unknown as MathNode;
    }
  };
  return node as unknown as MathNode;
}

describe('canonicalization hardening paths', () => {
  it('honors SymbolicContext domain and rewrite-limit defaults', () => {
    const math = createMath();
    const real = math.symbolic.with({
      operationDefaults: {domain: 'real', mode: 'conditional'}
    });
    const limited = math.symbolic.with({
      operationDefaults: {limits: {canonicalSteps: 0}}
    });

    expect(real.canonicalize(math.parse('0 * sqrt(-1)'), {
      profile: 'scalar'
    }).expression.toString()).toBe('0 * sqrt(-1)');
    expect(limited.canonicalize(math.parse('+x')).limit).toEqual({
      kind: 'limit',
      limit: 'canonicalSteps',
      used: 1,
      maximum: 0
    });
  });

  it('covers syntax-only and strict semantic rejection paths', () => {
    const math = createMath();
    const negativeZero = math.symbolic.canonicalize(
      new math.ConstantNode(-0)
    );
    const structuralSubtraction = math.symbolic.canonicalize(
      math.parse('x - y')
    );
    const structuralPower = math.symbolic.canonicalize(math.parse('x ^ 2'));
    const strictNegation = math.symbolic.canonicalize(math.parse('-x'), {
      profile: 'scalar'
    });
    const strictRoot = math.symbolic.canonicalize(math.parse('sqrt(x ^ 2)'), {
      profile: 'real-algebraic'
    });
    const emptyRoot = new math.FunctionNode(new math.SymbolNode('sqrt'), []);

    expect(isConstantNode(negativeZero.expression)).toBe(true);
    if (!isConstantNode(negativeZero.expression)) {
      throw new Error('Expected a normalized constant');
    }
    expect(Object.is(negativeZero.expression.value, -0)).toBe(false);
    expect(structuralSubtraction.expression.toString()).toBe('x - y');
    expect(structuralPower.expression.toString()).toBe('x ^ 2');
    expect(strictNegation.expression.toString()).toBe('-x');
    expect(strictRoot.expression.toString()).toBe('sqrt(x ^ 2)');
    expect(math.symbolic.canonicalize(emptyRoot, {
      profile: 'real-algebraic'
    }).expression.toString()).toBe('sqrt()');
  });

  it('folds exact powers and preserves nonintegral or malformed powers', () => {
    const math = createMath();
    const malformed = new math.OperatorNode(
      '^',
      'pow',
      [new math.ConstantNode(2)] as never
    );

    expect(math.symbolic.canonicalize(math.parse('2 ^ 3'), {
      profile: 'scalar'
    }).expression.toString()).toBe('8');
    expect(math.symbolic.canonicalize(math.parse('0 ^ 2'), {
      profile: 'scalar'
    }).expression.toString()).toBe('0');
    expect(math.symbolic.canonicalize(math.parse('4 ^ 0.5'), {
      profile: 'scalar'
    }).expression.toString()).toBe('4 ^ 0.5');
    expect(math.symbolic.canonicalize(malformed, {
      profile: 'scalar'
    }).expression.toString()).toBe('^2');
  });

  it('normalizes odd signs, cancelling constants, and empty identities', () => {
    const math = createMath();
    const options = {profile: 'scalar' as const, mode: 'conditional' as const};

    expect(math.symbolic.canonicalize(math.parse('(-x) * y'), options)
      .expression.toString({parenthesis: 'all'})).toBe('(-1 * x) * y');
    expect(math.symbolic.canonicalize(math.parse('x + 1 - 1'), options)
      .expression.toString()).toBe('x');
    expect(math.symbolic.canonicalize(math.parse('0 + 0'), {
      profile: 'scalar'
    }).expression.toString()).toBe('0');
    expect(math.symbolic.canonicalize(math.parse('1 * 1'), {
      profile: 'scalar'
    }).expression.toString()).toBe('1');
  });

  it('uses exact configured BigNumber division and rejects rounded division', () => {
    const math = createMath({number: 'BigNumber'});
    const exact = math.symbolic.canonicalize(math.parse('4 / 2'), {
      profile: 'scalar'
    }).expression;
    const rounded = math.symbolic.canonicalize(math.parse('1 / 3'), {
      profile: 'scalar'
    }).expression;
    const root = math.symbolic.canonicalize(math.parse('sqrt(4)'), {
      profile: 'complex-safe'
    }).expression;

    expect(isConstantNode(exact) && math.isBigNumber(exact.value)).toBe(true);
    expect(exact.toString()).toBe('2');
    expect(rounded.toString()).toBe('1 / 3');
    expect(isConstantNode(root) && math.isBigNumber(root.value)).toBe(true);
  });

  it('folds exact bigint operators without coercing through numbers', () => {
    const math = createMath();
    const power = new math.OperatorNode('^', 'pow', [
      new math.ConstantNode(2n),
      new math.ConstantNode(3n)
    ]);
    const division = new math.OperatorNode('/', 'divide', [
      new math.ConstantNode(4n),
      new math.ConstantNode(2n)
    ]);

    const powered = math.symbolic.canonicalize(power, {
      profile: 'scalar'
    }).expression;
    const divided = math.symbolic.canonicalize(division, {
      profile: 'scalar'
    }).expression;

    expect(isConstantNode(powered)).toBe(true);
    expect(isConstantNode(divided)).toBe(true);
    if (!isConstantNode(powered) || !isConstantNode(divided)) {
      throw new Error('Expected bigint constants');
    }
    expect(powered.value as unknown).toBe(8n);
    expect(divided.value as unknown).toBe(2n);
  });

  it('preserves non-symbol function callees', () => {
    const math = createMath();
    const node = new math.FunctionNode(math.parse('f[1]'), [
      new math.ConstantNode(2)
    ]);

    expect(math.symbolic.canonicalize(node, {
      profile: 'scalar'
    }).expression.toString()).toBe('f[1](2)');
  });

  it('preserves foldable registry entries when the MathJS function is absent or throws', () => {
    const math = createMath();
    const missingRegistry = math.symbolic.registry.withOperator({
      name: 'missingAdd',
      symbol: '⊕',
      arities: [2],
      commutative: 'scalar',
      associative: 'scalar',
      semantic: 'addition'
    });
    const OperatorNode = math.OperatorNode as unknown as new (
      op: string,
      fn: string,
      args: MathNode[]
    ) => MathNode;
    const missing = new OperatorNode(
      '+',
      'missingAdd',
      [new math.ConstantNode(2), new math.ConstantNode(3)]
    );
    const missingResult = math.symbolic.with({registry: missingRegistry})
      .canonicalize(missing, {profile: 'scalar'});

    math.import({explode: () => {
      throw new Error('boom');
    }});
    const throwingRegistry = math.symbolic.registry.withFunction({
      name: 'explode',
      minimumArguments: 1,
      maximumArguments: 1,
      semantic: 'absolute'
    });
    const throwing = new math.FunctionNode(new math.SymbolNode('explode'), [
      new math.ConstantNode(2)
    ]);
    const throwingResult = math.symbolic.with({registry: throwingRegistry})
      .canonicalize(throwing, {profile: 'scalar'});

    expect(missingResult.expression.toString()).toBe('2 + 3');
    expect(throwingResult.expression.toString()).toBe('explode(2)');
  });

  it('verifies registered root results before folding them', () => {
    const math = createMath();
    math.import({fakeRoot: () => 2});
    const registry = math.symbolic.registry.withFunction({
      name: 'fakeRoot',
      minimumArguments: 1,
      maximumArguments: 1,
      semantic: 'square-root'
    });
    const node = new math.FunctionNode(new math.SymbolNode('fakeRoot'), [
      new math.ConstantNode(5)
    ]);

    expect(math.symbolic.with({registry}).canonicalize(node, {
      profile: 'complex-safe'
    }).expression.toString()).toBe('fakeRoot(5)');
  });

  it('returns a post-rebuild node limit for an opaque expanding node', () => {
    const math = createMath();
    const expanded = math.parse('[x, y, z]');
    const source = opaqueNode({
      map: () => expanded
    });
    const result = math.symbolic.canonicalize(source, {maximumNodes: 2});

    expect(result.expression).toBe(expanded);
    expect(result.complete).toBe(false);
    expect(result.limit?.limit).toBe('canonicalNodes');
  });

  it('rethrows non-limit structural-analysis failures after rebuilding', () => {
    const math = createMath();
    const broken = opaqueNode({type: 'BrokenAnalysis'});
    (broken as unknown as {forEach: () => void}).forEach = () => {
      throw new Error('analysis failed');
    };
    const source = opaqueNode({map: () => broken});

    expect(() => math.symbolic.canonicalize(source))
      .toThrow('analysis failed');
  });

  it('rejects an active traversal cycle even when serialization is acyclic', () => {
    const math = createMath();
    let recursive!: MathNode;
    recursive = opaqueNode({
      type: 'RecursiveMap',
      json: {mathjs: 'RecursiveMap'},
      map: (callback, parent) => callback(parent, 'self', parent)
    });

    expect(() => math.symbolic.canonicalize(recursive))
      .toThrow('Cyclic MathJS node');
  });

  it('restores pre-existing requirements when an opaque child cannot rebuild', () => {
    const math = createMath();
    const opaque = opaqueNode({
      children: [math.parse('+z')],
      map: (callback, parent) => {
        callback(math.parse('+z'), 'child', parent);
        throw new Error('cannot rebuild');
      }
    });
    const sum = math.parse('y + x');
    const parent = opaqueNode({
      type: 'OpaqueParent',
      children: [sum, opaque],
      map: (callback, node) => {
        callback(sum, '0', node);
        callback(opaque, '1', node);
        return node;
      }
    });
    const result = math.symbolic.canonicalize(parent, {
      profile: 'scalar',
      mode: 'conditional'
    });
    const labels = result.requirements.map((requirement) =>
      requirement.kind === 'domain'
        ? requirement.domain
        : `${requirement.property}:${requirement.expression.toString()}`
    );

    expect(labels).toEqual(['scalar:x', 'scalar:y']);
    expect(result.expression).toBe(parent);
  });
});
