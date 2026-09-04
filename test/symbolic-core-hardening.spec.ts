import {all, create} from 'mathjs';
import type {MathNode} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import type {symbolicjsInstance} from '../src/index.js';
import {
  assume,
  AssumptionSet,
  predicateImplies,
  predicatesConflict
} from '../src/core/assumptions.js';
import {DefinednessAnalyzer} from '../src/core/definedness.js';
import {
  broaderDomain,
  narrowerDomain,
  validateOperationDomain
} from '../src/core/domains.js';
import {MathAdapter} from '../src/core/math-adapter.js';
import type {MathAdapterDependencies} from '../src/core/math-adapter.js';
import {
  createJudgment,
  oppositePredicate,
  predicateKey,
  samePredicateExpression
} from '../src/core/predicate.js';
import {SymbolicRegistry} from '../src/core/registry.js';
import {
  structuralFingerprint,
  structuralKey,
  structuralTypeRank
} from '../src/core/structural-key.js';

function createMath(config?: Parameters<typeof create>[1]): symbolicjsInstance {
  return importsymbolicjs(create(all!, config));
}

function adapterDependencies(math: symbolicjsInstance): MathAdapterDependencies {
  return {
    ConstantNode: math.ConstantNode,
    EqualityNode: math.EqualityNode,
    FunctionNode: math.FunctionNode,
    OperatorNode: math.OperatorNode,
    SymbolNode: math.SymbolNode,
    mathWithTransform: math as unknown as Readonly<Record<string, unknown>>,
    parse: math.parse,
    reviver: math.reviver
  };
}

function analyzer(math: symbolicjsInstance): DefinednessAnalyzer {
  return new DefinednessAnalyzer(
    math.symbolic.math,
    math.symbolic.nodes,
    math.symbolic.predicates,
    math.symbolic.registry
  );
}

function labels(predicates: readonly import('../src/core/predicate.js').SymbolicPredicate[]) {
  return predicates.map((predicate) => predicate.kind === 'domain'
    ? `${predicate.domain}:${predicate.expression.toString()}`
    : `${predicate.property}:${predicate.expression.toString()}`
  );
}

interface FakeNodeShape {
  readonly type?: string;
  readonly json?: unknown;
  readonly children?: readonly MathNode[];
  readonly toJson?: boolean;
}

function fakeNode({
  type = 'CustomNode',
  json = {mathjs: 'CustomNode'},
  children = [],
  toJson = true
}: FakeNodeShape = {}): MathNode {
  const node: Record<string, unknown> = {
    type,
    isNode: true,
    forEach(callback: (child: MathNode, path: string, parent: MathNode) => void) {
      children.forEach((child, index) => callback(child, String(index), node as unknown as MathNode));
    },
    toString() {
      return type;
    }
  };
  if (toJson) {
    node.toJSON = () => json;
  }
  return node as unknown as MathNode;
}

describe('symbolic core validation and persistent metadata', () => {
  it('covers both directions of domain selection and validates operation domains', () => {
    expect(narrowerDomain('integer', 'complex')).toBe('integer');
    expect(narrowerDomain('complex', 'integer')).toBe('integer');
    expect(broaderDomain('complex', 'integer')).toBe('complex');
    expect(broaderDomain('integer', 'complex')).toBe('complex');
    expect(validateOperationDomain('unknown')).toBe('unknown');
    expect(() => validateOperationDomain('matrix')).toThrow(TypeError);
  });

  it('exercises direct implication, conflict, and combined-query boundaries', () => {
    const math = createMath();
    const p = math.symbolic.predicates;
    const x = math.parse('x');
    const y = math.parse('y');

    expect(predicateImplies(p.real(x), p.real(x))).toBe(true);
    expect(predicateImplies(p.real(x), p.real(y))).toBe(false);
    expect(predicateImplies(p.finite(x), p.defined(x))).toBe(true);
    expect(predicateImplies(p.scalar(x), p.commutative(x))).toBe(true);
    expect(predicateImplies(p.defined(x), p.real(x))).toBe(false);
    expect(predicateImplies(p.positive(x), p.complex(x))).toBe(true);
    expect(predicateImplies(p.even(x), p.real(x))).toBe(true);
    expect(predicateImplies(p.defined(x), p.defined(x))).toBe(true);
    expect(predicatesConflict(p.real(x), p.complex(x))).toBe(false);
    expect(predicatesConflict(p.positive(x), p.negative(y))).toBe(false);

    const negative = new AssumptionSet([
      assume(p.nonpositive(x)),
      assume(p.nonzero(x))
    ]);
    expect(negative.ask(p.negative(x)).truth).toBe('proven');
    expect(negative.ask(p.positive(x)).truth).toBe('disproven');
  });

  it('creates every opposite predicate and leaves unpaired predicates alone', () => {
    const math = createMath();
    const p = math.symbolic.predicates;
    const x = math.parse('x');
    const pairs = [
      [p.zero(x), 'nonzero'],
      [p.nonzero(x), 'zero'],
      [p.positive(x), 'nonpositive'],
      [p.nonpositive(x), 'positive'],
      [p.negative(x), 'nonnegative'],
      [p.nonnegative(x), 'negative'],
      [p.even(x), 'odd'],
      [p.odd(x), 'even']
    ] as const;

    for (const [predicate, property] of pairs) {
      expect(oppositePredicate(predicate)).toMatchObject({kind: 'property', property});
    }
    expect(oppositePredicate(p.real(x))).toBeNull();
    expect(oppositePredicate(p.finite(x))).toBeNull();
    expect(samePredicateExpression(p.real(x), p.positive(x))).toBe(true);
    expect(predicateKey(p.real(x))).toContain('domain:real:');
  });

  it('freezes default judgments and rejects non-node predicates', () => {
    const math = createMath();
    const judgment = createJudgment('unknown');

    expect(judgment).toEqual({truth: 'unknown', requirements: [], evidence: []});
    expect(Object.isFrozen(judgment)).toBe(true);
    expect(Object.isFrozen(judgment.requirements)).toBe(true);
    expect(() => math.symbolic.predicates.real(null as never)).toThrow(TypeError);
  });

  it('validates every MathAdapter dependency and exposes false node checks', () => {
    const math = createMath();
    const valid = adapterDependencies(math);
    const functionDependencies = [
      'ConstantNode',
      'EqualityNode',
      'FunctionNode',
      'OperatorNode',
      'SymbolNode',
      'parse',
      'reviver'
    ] as const;

    for (const dependency of functionDependencies) {
      expect(() => new MathAdapter({...valid, [dependency]: null} as never))
        .toThrow(`MathJS dependency "${dependency}" must be a function`);
    }
    expect(() => new MathAdapter({...valid, mathWithTransform: null} as never))
      .toThrow('mathWithTransform');
    const adapter = new MathAdapter(valid);
    expect(adapter.isNode(null)).toBe(false);
    expect(adapter.lookup('definitelyMissing')).toBeUndefined();
  });

  it('normalizes registry arities and validates all metadata boundaries', () => {
    const registry = new SymbolicRegistry([{
      name: 'custom',
      symbol: '@',
      arities: [3, 1, 3],
      commutative: 'unknown',
      associative: 'unknown'
    }], [{
      name: 'f', minimumArguments: 0, maximumArguments: 2
    }]);

    expect(registry.getOperator('custom')?.arities).toEqual([1, 3]);
    expect(registry.getOperator('custom')?.semantic).toBe('opaque');
    expect(registry.getFunction('f')?.semantic).toBe('opaque');
    expect(registry.withFunction({
      name: 'f', minimumArguments: 1, maximumArguments: 1,
      semantic: 'absolute'
    }).getFunction('f')?.minimumArguments).toBe(1);
    expect(registry.getFunction('f')?.minimumArguments).toBe(0);

    expect(() => new SymbolicRegistry([{
      name: 'bad', symbol: '@', arities: [],
      commutative: 'never', associative: 'never'
    }])).toThrow(TypeError);
    expect(() => new SymbolicRegistry([{
      name: 'bad', symbol: '@', arities: [-1],
      commutative: 'never', associative: 'never'
    }])).toThrow(RangeError);
    expect(() => new SymbolicRegistry([{
      name: 'bad', symbol: '', arities: [1],
      commutative: 'never', associative: 'never'
    }])).toThrow(TypeError);
    expect(() => new SymbolicRegistry([{
      name: 'bad', symbol: '@', arities: [1],
      commutative: 'never', associative: 'never', semantic: 'invalid' as never
    }])).toThrow('Unknown operator semantic');
    expect(() => new SymbolicRegistry([], [{
      name: '', minimumArguments: 0, maximumArguments: 0
    }])).toThrow(TypeError);
    expect(() => new SymbolicRegistry([], [{
      name: 'bad', minimumArguments: -1, maximumArguments: 0
    }])).toThrow(RangeError);
    expect(() => new SymbolicRegistry([], [{
      name: 'bad', minimumArguments: 0, maximumArguments: 0,
      semantic: 'invalid' as never
    }])).toThrow('Unknown function semantic');
  });

  it('validates operation scope, memoization, tracing, and inherited defaults', () => {
    const math = createMath();
    expect(() => math.symbolic.operation({scope: [] as never})).toThrow(TypeError);

    const traced = math.symbolic.operation({diagnostics: true});
    expect(() => traced.memoize(null as never, 'x', () => 1)).toThrow(TypeError);
    expect(() => traced.memoize(math.parse('x'), '', () => 1)).toThrow(TypeError);
    expect(() => traced.memoize(math.parse('x'), 'x', null as never)).toThrow(TypeError);
    expect(() => traced.trace({stage: '', rule: 'rule'})).toThrow(TypeError);
    expect(() => traced.trace({stage: 'stage', rule: ''})).toThrow(TypeError);
    expect(traced.usage('missing')).toBe(0);

    const x = math.parse('x');
    const inherited = math.symbolic.operation({
      assumptions: [assume(math.symbolic.predicates.real(x))],
      scope: {x: 1},
      domain: 'real',
      limits: {work: 2}
    }).with({});
    expect(inherited.scope).toEqual({x: 1});
    expect(inherited.domain).toBe('real');
    expect(inherited.limits).toEqual({work: 2});
    expect(inherited.assumptions.ask(math.symbolic.predicates.real(x)).truth)
      .toBe('proven');
  });
});

describe('definedness obligations across the MathJS AST surface', () => {
  it('unwraps parentheses, validates input, and can omit leaf obligations', () => {
    const math = createMath();
    const definedness = analyzer(math);
    const wrapped = new math.ParenthesisNode(math.parse('x'));

    expect(labels(definedness.requirements(wrapped))).toEqual(['defined:x']);
    expect(definedness.requirements(math.parse('x'), {
      includeLeafDefinedness: false
    })).toEqual([]);
    expect(() => definedness.requirements(null as never)).toThrow(TypeError);
  });

  it('handles configured exponents, failed exponent evaluation, and opaque operators', () => {
    const fraction = createMath({number: 'Fraction'});
    const x = fraction.parse('x');
    const halfPower = fraction.symbolic.nodes.operator('^', 'pow', [
      x,
      fraction.symbolic.nodes.constant(fraction.fraction(1, 2))
    ]);
    expect(labels(analyzer(fraction).requirements(halfPower, {
      domain: 'real', includeLeafDefinedness: false
    }))).toContain('nonnegative:x');

    const math = createMath();
    const failedExponent = math.symbolic.nodes.operator('^', 'pow', [
      math.parse('x'),
      math.symbolic.nodes.call('missing', [])
    ]);
    expect(labels(analyzer(math).requirements(failedExponent, {
      domain: 'real', includeLeafDefinedness: false
    }))).toContain('defined:missing()');

    const opaque = math.symbolic.nodes.operator('@', 'mystery', [math.parse('x')]);
    expect(labels(analyzer(math).requirements(opaque, {
      includeLeafDefinedness: false
    }))).toEqual([`defined:${opaque.toString()}`]);
    expect(analyzer(math).requirements(opaque, {
      includeLeafDefinedness: false,
      legacySolverCompatibility: true
    })).toEqual([]);
  });

  it('handles missing function arguments and all nth-root degree cases', () => {
    const math = createMath();
    const definedness = analyzer(math);
    const noArgument = new math.FunctionNode(new math.SymbolNode('sqrt'), []);
    expect(labels(definedness.requirements(noArgument, {
      domain: 'real', includeLeafDefinedness: false
    }))).toContain('defined:sqrt()');

    expect(labels(definedness.requirements(math.parse('nthRoot(x)'), {
      domain: 'real', includeLeafDefinedness: false
    }))).toEqual([]);
    expect(labels(definedness.requirements(math.parse('nthRoot(x, 3)'), {
      domain: 'real', includeLeafDefinedness: false
    }))).toContain('nonzero:3');
    expect(labels(definedness.requirements(math.parse('nthRoot(x, 4)'), {
      domain: 'real', includeLeafDefinedness: false
    }))).toEqual(expect.arrayContaining(['nonnegative:x', 'nonzero:4']));
    expect(labels(definedness.requirements(math.parse('nthRoot(x, n)'), {
      domain: 'real', includeLeafDefinedness: false
    }))).toContain('nonzero:n');
  });

  it('emits logarithm-base and inverse-circular obligations by domain', () => {
    const math = createMath();
    const definedness = analyzer(math);
    const realLog = labels(definedness.requirements(math.parse('log(x, b)'), {
      domain: 'real', includeLeafDefinedness: false
    }));
    const complexLog = labels(definedness.requirements(math.parse('log(x, b)'), {
      domain: 'complex', includeLeafDefinedness: false
    }));

    expect(realLog).toEqual(expect.arrayContaining([
      'positive:x', 'positive:b', 'nonzero:b - 1'
    ]));
    expect(complexLog).toEqual(expect.arrayContaining([
      'nonzero:x', 'nonzero:b', 'nonzero:b - 1'
    ]));
    expect(labels(definedness.requirements(math.parse('asin(x) + acos(y)'), {
      domain: 'real', includeLeafDefinedness: false
    }))).toEqual(expect.arrayContaining([
      'nonnegative:1 - x ^ 2', 'nonnegative:1 - y ^ 2'
    ]));
  });

  it('recurses through custom equation nodes', () => {
    const math = createMath();
    const equation = math.parseEquation('x + 1 =:= y');
    expect(labels(analyzer(math).requirements(equation))).toEqual([
      'defined:1', 'defined:x', 'defined:y'
    ]);
  });
});

describe('semantic inference over values, operators, and functions', () => {
  it('returns satisfied requirements and classifies non-finite and non-scalar values', () => {
    const math = createMath();
    const p = math.symbolic.predicates;
    expect(math.symbolic.require(p.positive(math.parse('2'))).kind).toBe('satisfied');

    const infinity = math.symbolic.nodes.constant(Number.POSITIVE_INFINITY);
    const undefinedValue = math.symbolic.nodes.constant(undefined as never);
    const nullValue = math.symbolic.nodes.constant(null as never);
    const array = math.parse('[1, 2]');

    expect(math.symbolic.ask(p.complex(infinity)).truth).toBe('disproven');
    expect(math.symbolic.ask(p.finite(infinity)).truth).toBe('disproven');
    expect(math.symbolic.ask(p.defined(undefinedValue)).truth).toBe('disproven');
    expect(math.symbolic.ask(p.defined(nullValue)).truth).toBe('disproven');
    expect(math.symbolic.ask(p.scalar(array)).truth).toBe('disproven');
    expect(math.symbolic.ask(p.real(array)).truth).toBe('disproven');
  });

  it('classifies bigint, signed bounds, and complex rationality', () => {
    const math = createMath();
    const p = math.symbolic.predicates;
    const bigint = math.symbolic.nodes.constant(4n);
    const zero = math.parse('0');
    const imaginary = math.symbolic.nodes.constant(math.complex(0, 1));

    expect(math.symbolic.ask(p.integer(bigint)).truth).toBe('proven');
    expect(math.symbolic.ask(p.even(bigint)).truth).toBe('proven');
    expect(math.symbolic.ask(p.nonnegative(zero)).truth).toBe('proven');
    expect(math.symbolic.ask(p.nonpositive(zero)).truth).toBe('proven');
    expect(math.symbolic.ask(p.rational(imaginary)).truth).toBe('disproven');
  });

  it('falls back to MathJS prototype markers when a namespace guard throws', () => {
    const math = createMath();
    const value = math.complex(2, 3);
    math.import({
      isComplex: () => {
        throw new Error('guard failure');
      }
    }, {override: true});
    const node = math.symbolic.nodes.constant(value);

    expect(math.symbolic.ask(math.symbolic.predicates.complex(node)).truth)
      .toBe('proven');
  });

  it('forwards domain and property queries through ParenthesisNode', () => {
    const math = createMath();
    const x = math.parse('x');
    const wrapped = new math.ParenthesisNode(x);
    const assumptions = [
      assume(math.symbolic.predicates.real(x)),
      assume(math.symbolic.predicates.positive(x))
    ];

    expect(math.symbolic.ask(math.symbolic.predicates.real(wrapped), {
      assumptions
    }).truth).toBe('proven');
    expect(math.symbolic.ask(math.symbolic.predicates.positive(wrapped), {
      assumptions
    }).truth).toBe('proven');
  });

  it('propagates domains across arithmetic and rejects disproven requirements', () => {
    const math = createMath();
    const p = math.symbolic.predicates;
    const x = math.parse('x');
    const y = math.parse('y');
    const assumptions = [
      assume(p.integer(x)),
      assume(p.integer(y)),
      assume(p.nonzero(y))
    ];

    for (const expression of ['x + y', 'x - y', '-x', 'x * y']) {
      expect(math.symbolic.ask(p.integer(math.parse(expression)), {assumptions}).truth)
        .toBe('proven');
    }
    expect(math.symbolic.ask(p.integer(math.parse('x / y')), {assumptions}).truth)
      .toBe('unknown');
    expect(math.symbolic.ask(p.real(math.parse('x / y')), {assumptions}).truth)
      .toBe('proven');
    expect(math.symbolic.ask(p.real(math.parse('x ^ 2')), {assumptions}).truth)
      .toBe('unknown');

    const contradicted = [
      assume(p.real(x)),
      assume(p.real(y), 'disproven')
    ];
    expect(math.symbolic.ask(p.real(math.parse('x + y')), {
      assumptions: contradicted
    }).truth).toBe('disproven');
  });

  it('infers scalarity, negation properties, zero factors, and finite arithmetic', () => {
    const math = createMath();
    const p = math.symbolic.predicates;
    const x = math.parse('x');
    const y = math.parse('y');
    const assumptions = [
      assume(p.scalar(x)),
      assume(p.scalar(y)),
      assume(p.positive(x)),
      assume(p.finite(x)),
      assume(p.finite(y)),
      assume(p.nonzero(y))
    ];

    expect(math.symbolic.ask(p.scalar(math.parse('x + y')), {assumptions}).truth)
      .toBe('proven');
    expect(math.symbolic.ask(p.commutative(math.parse('x * y')), {assumptions}).truth)
      .toBe('proven');
    expect(math.symbolic.ask(p.negative(math.parse('-x')), {assumptions}).truth)
      .toBe('proven');
    expect(math.symbolic.ask(p.zero(math.parse('x * 0'))).truth).toBe('proven');
    expect(math.symbolic.ask(p.finite(math.parse('x + y')), {assumptions}).truth)
      .toBe('proven');
    expect(math.symbolic.ask(p.finite(math.parse('x / y')), {assumptions}).truth)
      .toBe('proven');
  });

  it('covers registered and opaque function semantics', () => {
    const math = createMath();
    const p = math.symbolic.predicates;
    const x = math.parse('x');
    const assumptions = [
      assume(p.real(x)),
      assume(p.nonnegative(x)),
      assume(p.scalar(x))
    ];

    expect(math.symbolic.ask(p.real(math.parse('missing(x)')), {assumptions}).truth)
      .toBe('unknown');
    expect(math.symbolic.ask(p.integer(math.parse('sqrt(x)')), {assumptions}).truth)
      .toBe('unknown');
    expect(math.symbolic.ask(p.scalar(math.parse('sin(x)')), {assumptions}).truth)
      .toBe('proven');
    expect(math.symbolic.ask(p.commutative(math.parse('cos(x)')), {assumptions}).truth)
      .toBe('proven');
    expect(math.symbolic.ask(p.nonnegative(math.parse('abs(x)')), {assumptions}).truth)
      .toBe('proven');
    expect(math.symbolic.ask(p.nonnegative(math.parse('sqrt(x)')), {assumptions}).truth)
      .toBe('proven');

    const noArgument = new math.FunctionNode(new math.SymbolNode('sqrt'), []);
    expect(math.symbolic.ask(p.real(noArgument)).truth).toBe('unknown');
  });

  it('reports a disproven structural definedness dependency', () => {
    const math = createMath();
    const p = math.symbolic.predicates;
    const x = math.parse('x');
    const quotient = math.parse('1 / x');
    const judgment = math.symbolic.ask(p.defined(quotient), {
      domain: 'real', assumptions: [assume(p.zero(x))]
    });

    expect(judgment.truth).toBe('disproven');
  });
});

describe('lossless structural identity edge cases', () => {
  it('encodes special numbers, bigint, symbols, functions, and undefined values', () => {
    const math = createMath();
    const nodes = [
      math.symbolic.nodes.constant(Number.NaN),
      math.symbolic.nodes.constant(Number.POSITIVE_INFINITY),
      math.symbolic.nodes.constant(Number.NEGATIVE_INFINITY),
      math.symbolic.nodes.constant(4n),
      fakeNode({json: {
        mathjs: 'CustomNode',
        missing: undefined,
        marker: Symbol('marker'),
        fn: function namedFunction() { return 1; },
        enabled: true,
        value: null
      }})
    ];
    const keys = nodes.map((node) => structuralKey(node));

    expect(keys.join('|')).toContain('number:NaN');
    expect(keys.join('|')).toContain('number:+Infinity');
    expect(keys.join('|')).toContain('number:-Infinity');
    expect(keys.join('|')).toContain('bigint:4');
    expect(keys.join('|')).toContain('symbol:"marker"');
    expect(keys.join('|')).toContain('function:"namedFunction"');
    expect(keys.join('|')).toContain('undefined');
    expect(keys.join('|')).toContain('null');
    expect(structuralFingerprint(nodes[0]!)).toMatch(/^s1-[0-9a-f]{16}$/);
  });

  it('uses custom toJSON values and fallback public fields deterministically', () => {
    class Value {
      toJSON() {
        return {z: 2, a: 1};
      }
    }
    const withJson = fakeNode({json: {value: new Value()}});
    const withoutJson = fakeNode({toJson: false}) as MathNode & Record<string, unknown>;
    withoutJson.visible = 1;
    withoutJson._private = 2;

    expect(structuralKey(withJson)).toContain('json:"Value"');
    expect(structuralKey(withoutJson)).toContain('"visible":number:1');
    expect(structuralKey(withoutJson)).not.toContain('_private');
    expect(structuralTypeRank(withoutJson)).toBe(1000);
  });

  it('rejects cyclic custom JSON, cyclic arrays, and cyclic structural traversal', () => {
    let cyclicNode!: MathNode;
    cyclicNode = fakeNode({json: {get child() { return cyclicNode; }}});
    expect(() => structuralKey(cyclicNode)).toThrow('Cyclic value');

    const cyclicArray: unknown[] = [];
    cyclicArray.push(cyclicArray);
    expect(() => structuralKey(fakeNode({json: cyclicArray})))
      .toThrow('Cyclic array');

    let recursive!: MathNode;
    recursive = fakeNode({children: []});
    (recursive as unknown as Record<string, unknown>).forEach = (
      callback: (child: MathNode, path: string, parent: MathNode) => void
    ) => callback(recursive, 'self', recursive);
    const math = createMath();
    expect(() => math.symbolic.structure.analyze(recursive))
      .toThrow('Cyclic MathJS node');
  });

  it('validates structural options, limits, sorting input, and analysis nodes', () => {
    const math = createMath();
    const structure = math.symbolic.structure;
    const x = math.parse('x');

    expect(() => structure.cost(x, {maximumNodes: 0})).toThrow('maximumNodes');
    expect(() => structure.cost(x, {maximumDepth: 0})).toThrow('maximumDepth');
    expect(() => structure.cost(x, {weights: {node: Number.POSITIVE_INFINITY}}))
      .toThrow('finite and nonnegative');
    expect(() => structure.cost(x, {parentheses: 'bad' as never})).toThrow(TypeError);
    expect(() => structure.analyze(null as never)).toThrow(TypeError);
    expect(() => structure.sort(null as never)).toThrow(TypeError);
    expect(structure.equals(x, x)).toBe(true);
    expect(structure.compare(x, x)).toBe(0);
  });
});
