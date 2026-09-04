import {all, create} from 'mathjs';
import {describe, expect, it, vi} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import {assume, AssumptionSet} from '../src/core/assumptions.js';
import {
  DEFAULT_EXPRESSION_COST_WEIGHTS,
  StructuralEngine
} from '../src/core/structure.js';
import {
  structuralFingerprintFromKey,
  structuralKey,
  structuralTypeRank
} from '../src/core/structural-key.js';

function createMath(config?: Parameters<typeof create>[1]) {
  return importsymbolicjs(config === undefined
    ? create(all!)
    : create(all!, config));
}

describe('stable MathJS structural identity', () => {
  it('matches independently parsed and revived equivalent trees', () => {
    const first = createMath();
    const second = createMath();
    const left = first.parse('x^2 + sin(y)');
    const right = second.parse('x^2 + sin(y)');
    const equation = first.parseEquation('x^2 + 1 =:= y');
    const revived = first.symbolic.math.revive<typeof equation>(
      JSON.stringify(equation)
    );

    expect(first.symbolic.structure.key(left))
      .toBe(second.symbolic.structure.key(right));
    expect(first.symbolic.structure.fingerprint(left))
      .toBe(second.symbolic.structure.fingerprint(right));
    expect(first.symbolic.structure.equals(left, right)).toBe(true);
    expect(first.symbolic.structure.equals(equation, revived)).toBe(true);
    expect(first.symbolic.structure.compare(equation, revived)).toBe(0);
  });

  it('preserves semantic AST distinctions hidden by casual formatting', () => {
    const math = createMath();
    const explicit = math.symbolic.nodes.operator(
      '*',
      'multiply',
      [math.symbolic.nodes.constant(2), math.symbolic.nodes.symbol('x')],
      false
    );
    const implicit = math.symbolic.nodes.operator(
      '*',
      'multiply',
      [math.symbolic.nodes.constant(2), math.symbolic.nodes.symbol('x')],
      true
    );
    const zero = math.symbolic.nodes.constant(0);
    const negativeZero = math.symbolic.nodes.constant(-0);
    const array12 = math.parse('[1, 2]');
    const array21 = math.parse('[2, 1]');

    expect(math.symbolic.structure.key(explicit))
      .not.toBe(math.symbolic.structure.key(implicit));
    expect(math.symbolic.structure.key(zero))
      .not.toBe(math.symbolic.structure.key(negativeZero));
    expect(math.symbolic.structure.key(array12))
      .not.toBe(math.symbolic.structure.key(array21));
    expect(math.symbolic.structure.equals(explicit, implicit)).toBe(false);
  });

  it('supports explicit parenthesis-preserving and transparent policies', () => {
    const math = createMath();
    const bare = math.parse('x + 1');
    const parenthesized = math.parse('(x + 1)');

    expect(math.symbolic.structure.equals(bare, parenthesized, {
      parentheses: 'preserve'
    })).toBe(false);
    expect(math.symbolic.structure.equals(bare, parenthesized, {
      parentheses: 'transparent'
    })).toBe(true);
    expect(math.symbolic.structure.compare(bare, parenthesized, {
      parentheses: 'transparent'
    })).toBe(0);
  });

  it('canonicalizes object record key order but preserves array order', () => {
    const math = createMath();
    const first = math.parse('{b: 2, a: 1}');
    const second = math.parse('{a: 1, b: 2}');

    expect(math.symbolic.structure.equals(first, second)).toBe(true);
    expect(math.symbolic.structure.fingerprint(first))
      .toBe(math.symbolic.structure.fingerprint(second));
  });

  it('distinguishes configured numeric representations', () => {
    const normal = createMath();
    const big = createMath({number: 'BigNumber'});
    const fraction = createMath({number: 'Fraction'});
    const normalOne = normal.symbolic.nodes.constant(1);
    const bigOne = big.symbolic.nodes.constant(big.bignumber(1));
    const fractionOne = fraction.symbolic.nodes.constant(fraction.fraction(1));

    expect(normal.symbolic.structure.key(normalOne))
      .not.toBe(big.symbolic.structure.key(bigOne));
    expect(normal.symbolic.structure.key(normalOne))
      .not.toBe(fraction.symbolic.structure.key(fractionOne));
    expect(big.symbolic.structure.key(bigOne))
      .not.toBe(fraction.symbolic.structure.key(fractionOne));
  });

  it('produces deterministic non-authoritative fingerprints', () => {
    const math = createMath();
    const expressions = [
      'x',
      'x + 1',
      'x - 1',
      'x * y',
      'sin(x)',
      '[x, y]',
      '{x: 1}'
    ].map((source) => math.parse(source));
    const keys = expressions.map((node) => structuralKey(node));
    const fingerprints = keys.map(structuralFingerprintFromKey);

    expect(fingerprints.every((value) => /^s1-[0-9a-f]{16}$/.test(value)))
      .toBe(true);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
    expect(fingerprints).toEqual(keys.map(structuralFingerprintFromKey));
  });

  it('rejects non-nodes and invalid policies', () => {
    const math = createMath();

    expect(() => structuralKey(null as never)).toThrow(TypeError);
    expect(() => structuralTypeRank(null as never)).toThrow(TypeError);
    expect(() => math.symbolic.structure.key(math.parse('x'), {
      parentheses: 'invalid' as never
    })).toThrow(TypeError);
    expect(() => math.symbolic.structure.sort([math.parse('x'), null as never]))
      .toThrow(TypeError);
  });
});

describe('deterministic structural ordering', () => {
  it('defines a stable total order without mutating caller arrays', () => {
    const math = createMath();
    const input = [
      math.parse('sin(x)'),
      math.parse('x + 1'),
      math.parse('x'),
      math.parse('1')
    ];
    const before = [...input];
    const sorted = math.symbolic.structure.sort(input);

    expect(sorted.map((node) => node.type)).toEqual([
      'ConstantNode',
      'SymbolNode',
      'OperatorNode',
      'FunctionNode'
    ]);
    expect(input).toEqual(before);
    expect(Object.isFrozen(sorted)).toBe(true);
  });

  it('is antisymmetric and transitive for representative MathJS nodes', () => {
    const math = createMath();
    const structure = math.symbolic.structure;
    const nodes = [
      math.parse('2'),
      math.parse('x'),
      math.parse('x + 1'),
      math.parse('x * y'),
      math.parse('sin(x)'),
      math.parse('[1, 2]'),
      math.parse('{a: 1}')
    ];

    for (const left of nodes) {
      for (const right of nodes) {
        const forward = Math.sign(structure.compare(left, right));
        const reverse = Math.sign(structure.compare(right, left));
        expect(forward + reverse).toBe(0);
        expect(forward === 0).toBe(reverse === 0);
      }
    }

    const sorted = structure.sort(nodes);
    for (let first = 0; first < sorted.length; first += 1) {
      for (let second = first; second < sorted.length; second += 1) {
        for (let third = second; third < sorted.length; third += 1) {
          expect(structure.compare(sorted[first]!, sorted[second]!)).toBeLessThanOrEqual(0);
          expect(structure.compare(sorted[second]!, sorted[third]!)).toBeLessThanOrEqual(0);
          expect(structure.compare(sorted[first]!, sorted[third]!)).toBeLessThanOrEqual(0);
        }
      }
    }
  });
});

describe('syntax-aware expression cost', () => {
  it('records stable metrics and a target-aware default score', () => {
    const math = createMath();
    const analysis = math.symbolic.structure.analyze(
      math.parse('sin(x^2 / y) + x'),
      {target: 'x'}
    );

    expect(analysis.cost.metrics).toEqual({
      nodeCount: 8,
      leafCount: 4,
      maximumDepth: 5,
      constantCount: 1,
      symbolCount: 3,
      distinctSymbols: ['x', 'y'],
      targetOccurrences: 2,
      operatorCount: 3,
      functionCount: 1,
      divisionCount: 1,
      powerCount: 1,
      maximumFunctionDepth: 1,
      maximumArity: 2
    });
    expect(analysis.cost.weights).toEqual(DEFAULT_EXPRESSION_COST_WEIGHTS);
    expect(analysis.cost.score).toBe(30);
    expect(analysis.fingerprint).toMatch(/^s1-[0-9a-f]{16}$/);
    expect(Object.isFrozen(analysis)).toBe(true);
    expect(Object.isFrozen(analysis.cost)).toBe(true);
    expect(Object.isFrozen(analysis.cost.metrics)).toBe(true);
    expect(Object.isFrozen(analysis.cost.metrics.distinctSymbols)).toBe(true);
  });

  it('orders simpler expressions first and uses structure as a final tie breaker', () => {
    const math = createMath();
    const x = math.parse('x');
    const nested = math.parse('sin(sin(x))');
    const left = math.parse('x + 1');
    const right = math.parse('x + 2');

    expect(math.symbolic.structure.compareCost(x, nested)).toBeLessThan(0);
    expect(Math.sign(math.symbolic.structure.compareCost(left, right)))
      .toBe(-Math.sign(math.symbolic.structure.compareCost(right, left)));
  });

  it('supports deterministic custom weights and transparent parentheses', () => {
    const math = createMath();
    const bare = math.parse('x + 1');
    const wrapped = math.parse('(x + 1)');
    const weights = {
      node: 0,
      depth: 0,
      operator: 0,
      function: 0,
      division: 0,
      power: 0,
      targetOccurrence: 5
    };

    expect(math.symbolic.structure.cost(bare, {
      target: 'x', weights
    }).score).toBe(5);
    expect(math.symbolic.structure.cost(wrapped, {
      target: 'x', weights, parentheses: 'transparent'
    })).toEqual(math.symbolic.structure.cost(bare, {
      target: 'x', weights, parentheses: 'transparent'
    }));
  });

  it('memoizes analysis only within one operation context', () => {
    const math = createMath();
    const node = math.parse('x^2 + 1');
    const operation = math.symbolic.operation();
    const first = math.symbolic.structure.analyze(node, {target: 'x'}, operation);
    const second = math.symbolic.structure.analyze(node, {target: 'x'}, operation);
    const separate = math.symbolic.structure.analyze(
      node,
      {target: 'x'},
      math.symbolic.operation()
    );

    expect(second).toBe(first);
    expect(separate).not.toBe(first);
    expect(separate).toEqual(first);
  });

  it('enforces analysis limits and validates cost configuration', () => {
    const math = createMath();
    const node = math.parse('sin(x^2 + 1)');

    expect(() => math.symbolic.structure.analyze(node, {maximumNodes: 2}))
      .toThrow('maximumNodes');
    expect(() => math.symbolic.structure.analyze(node, {maximumDepth: 2}))
      .toThrow('maximumDepth');
    expect(() => math.symbolic.structure.cost(node, {
      weights: {node: -1}
    })).toThrow(RangeError);
    expect(() => math.symbolic.structure.cost(node, {target: ''}))
      .toThrow(TypeError);
  });

  it('does not mutate input nodes while analyzing them', () => {
    const math = createMath();
    const node = math.parse('sin(x) + x^2');
    const before = JSON.stringify(node);
    const traverse = vi.spyOn(node, 'forEach');

    math.symbolic.structure.analyze(node, {target: 'x'});

    expect(JSON.stringify(node)).toBe(before);
    expect(traverse).toHaveBeenCalled();
  });
});

describe('predicate identity uses the shared structural key', () => {
  it('matches equivalent nodes parsed separately after Chapter 3 migration', () => {
    const math = createMath();
    const assumed = math.parse('x + 1');
    const queried = math.parse('x + 1');
    const assumptions = new AssumptionSet([
      assume(math.symbolic.predicates.positive(assumed))
    ]);

    expect(assumptions.ask(math.symbolic.predicates.positive(queried)).truth)
      .toBe('proven');
    expect(math.symbolic.structure.key(assumed, {parentheses: 'preserve'}))
      .toBe(math.symbolic.structure.key(queried, {parentheses: 'preserve'}));
  });

  it('does not confuse equal-looking but structurally distinct nodes', () => {
    const math = createMath();
    const structure = new StructuralEngine(math.symbolic.math);
    const explicit = math.symbolic.nodes.operator(
      '*', 'multiply', [math.parse('2'), math.parse('x')], false
    );
    const implicit = math.symbolic.nodes.operator(
      '*', 'multiply', [math.parse('2'), math.parse('x')], true
    );
    const assumptions = new AssumptionSet([
      assume(math.symbolic.predicates.positive(explicit))
    ]);

    expect(structure.equals(explicit, implicit)).toBe(false);
    expect(assumptions.ask(math.symbolic.predicates.positive(implicit)).truth)
      .toBe('unknown');
  });
});
