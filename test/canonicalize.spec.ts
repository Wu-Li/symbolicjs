import {all, create, isConstantNode} from 'mathjs';
import type {MathNode} from 'mathjs';
import fc from 'fast-check';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import {assume} from '../src/core/assumptions.js';
import type {CanonicalizationProfile} from '../src/core/canonicalize/types.js';
import type {symbolicjsInstance} from '../src/types.js';

function createMath(config?: Parameters<typeof create>[1]): symbolicjsInstance {
  return importsymbolicjs(config === undefined
    ? create(all!)
    : create(all!, config));
}

function requirementLabels(
  requirements: ReturnType<symbolicjsInstance['symbolic']['canonicalize']>['requirements']
): string[] {
  return requirements.map((predicate) => {
    const qualifier = predicate.kind === 'domain'
      ? predicate.domain
      : predicate.property;
    return `${predicate.kind}:${qualifier}:${predicate.expression.toString()}`;
  });
}

function realAssumptions(math: symbolicjsInstance, ...names: string[]) {
  return names.map((name) => assume(
    math.symbolic.predicates.real(math.parse(name))
  ));
}

function canonicalString(
  math: symbolicjsInstance,
  source: string,
  profile: CanonicalizationProfile,
  options: Parameters<symbolicjsInstance['symbolic']['canonicalize']>[1] = {}
): string {
  return math.symbolic.canonicalize(math.parse(source), {
    ...options,
    profile
  }).expression.toString({parenthesis: 'all'});
}

describe('canonicalization profiles and syntax-safe normalization', () => {
  it('removes redundant parentheses and unary plus and normalizes negative zero', () => {
    const math = createMath();
    const result = math.symbolic.canonicalize(math.parse('+((-0))'));

    expect(result.expression.toString()).toBe('0');
    expect(result.profile).toBe('structural');
    expect(result.changed).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.requirements).toEqual([]);
    expect(result.trace.map((step) => step.rule)).toEqual([
      'fold-unary-minus',
      'remove-parentheses',
      'remove-parentheses',
      'remove-unary-plus'
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.trace)).toBe(true);
  });

  it('keeps structural operand grouping and order while rebuilding children', () => {
    const math = createMath();
    const left = math.symbolic.canonicalize(math.parse('z + (y + x)'));
    const right = math.symbolic.canonicalize(math.parse('x + (y + z)'));

    expect(left.expression.toString({parenthesis: 'all'})).toBe('z + (y + x)');
    expect(right.expression.toString({parenthesis: 'all'})).toBe('x + (y + z)');
    expect(math.symbolic.structure.equals(left.expression, right.expression))
      .toBe(false);
    expect(left.trace.map((step) => step.rule)).toContain('remove-parentheses');
    expect(left.trace.map((step) => step.rule)).not.toContain('sort-addition');
  });

  it('does not mutate the caller-owned MathJS tree', () => {
    const math = createMath();
    const input = math.parse('y * (2 + x)');
    const before = JSON.stringify(input);

    math.symbolic.canonicalize(input, {
      profile: 'scalar',
      mode: 'conditional'
    });

    expect(JSON.stringify(input)).toBe(before);
    expect(input.toString()).toBe('y * (2 + x)');
  });

  it('canonicalizes equality sides without replacing EqualityNode syntax', () => {
    const math = createMath();
    const result = math.symbolic.canonicalize(
      math.parseEquation('(y + 0) =:= +(x)'),
      {profile: 'scalar', mode: 'conditional'}
    );

    expect(result.expression.type).toBe('EqualityNode');
    expect(result.expression.toString()).toBe('y =:= x');
    expect((result.expression as {isEqualityNode?: boolean}).isEqualityNode).toBe(true);
    expect(result.trace.map((step) => step.rule)).toContain('rebuild-equality');
  });

  it('canonicalizes supported children of non-arithmetic MathJS nodes', () => {
    const math = createMath();
    const result = math.symbolic.canonicalize(math.parse('[+(x), ((y))]'));

    expect(result.expression.toString()).toBe('[x, y]');
    expect(result.trace.map((step) => step.rule)).toContain('rebuild-node');
  });

  it('preserves opaque nodes and rolls back child trace state when rebuilding fails', () => {
    const math = createMath();
    const child = math.parse('+x');
    const opaque = {
      type: 'OpaqueNode',
      isNode: true,
      toJSON: () => ({mathjs: 'OpaqueNode', value: 'stable'}),
      toString: () => 'opaque(+x)',
      forEach(callback: (node: MathNode, path: string, parent: MathNode) => void) {
        callback(child, 'child', this as unknown as MathNode);
      },
      map(callback: (node: MathNode, path: string, parent: MathNode) => MathNode) {
        callback(child, 'child', this as unknown as MathNode);
        throw new Error('Opaque node cannot be rebuilt');
      }
    } as unknown as MathNode;

    const result = math.symbolic.canonicalize(opaque);

    expect(result.expression).toBe(opaque);
    expect(result.changed).toBe(false);
    expect(result.trace).toEqual([]);
    expect(result.requirements).toEqual([]);
  });

  it('rejects cyclic opaque-node serialization deterministically', () => {
    const math = createMath();
    let cyclic!: MathNode;
    cyclic = {
      type: 'CyclicNode',
      isNode: true,
      toJSON: () => ({mathjs: 'CyclicNode', child: cyclic}),
      toString: () => 'cyclic',
      forEach: () => undefined,
      map: () => cyclic
    } as unknown as MathNode;

    expect(() => math.symbolic.canonicalize(cyclic)).toThrow('Cyclic value');
  });
});

describe('scalar associative and commutative canonicalization', () => {
  it('flattens, sorts, folds constants, and normalizes coefficients conditionally', () => {
    const math = createMath();
    const sum = math.symbolic.canonicalize(math.parse('y + (2 + x)'), {
      profile: 'scalar', mode: 'conditional'
    });
    const equivalentSum = math.symbolic.canonicalize(math.parse('x + y + 2'), {
      profile: 'scalar', mode: 'conditional'
    });
    const product = math.symbolic.canonicalize(math.parse('y * 3 * x * 2'), {
      profile: 'scalar', mode: 'conditional'
    });

    expect(math.symbolic.structure.equals(sum.expression, equivalentSum.expression))
      .toBe(true);
    expect(sum.expression.toString({parenthesis: 'all'})).toBe('(2 + x) + y');
    expect(product.expression.toString({parenthesis: 'all'})).toBe('(6 * x) * y');
    expect(requirementLabels(sum.requirements)).toEqual([
      'property:scalar:x',
      'property:scalar:y'
    ]);
    expect(requirementLabels(product.requirements)).toEqual([
      'property:scalar:x',
      'property:scalar:y'
    ]);
    expect(sum.trace.map((step) => step.rule)).toContain('flatten-addition');
    expect(product.trace.map((step) => step.rule))
      .toContain('fold-multiplicative-constants');
  });

  it('requires proof in strict mode and accepts real assumptions as scalar proof', () => {
    const math = createMath();
    const strictLeft = math.symbolic.canonicalize(math.parse('y + x'), {
      profile: 'scalar'
    });
    const strictRight = math.symbolic.canonicalize(math.parse('x + y'), {
      profile: 'scalar'
    });
    const assumptions = realAssumptions(math, 'x', 'y');
    const provenLeft = math.symbolic.canonicalize(math.parse('y + x'), {
      profile: 'scalar', assumptions
    });
    const provenRight = math.symbolic.canonicalize(math.parse('x + y'), {
      profile: 'scalar', assumptions
    });

    expect(math.symbolic.structure.equals(strictLeft.expression, strictRight.expression))
      .toBe(false);
    expect(math.symbolic.structure.equals(provenLeft.expression, provenRight.expression))
      .toBe(true);
    expect(provenLeft.requirements).toEqual([]);
  });

  it('does not reorder matrix-valued symbols from a supplied scope', () => {
    const math = createMath();
    const scope = {
      A: math.matrix([[1, 2], [3, 4]]),
      B: math.matrix([[0, 1], [1, 0]])
    };
    const left = math.symbolic.canonicalize(math.parse('A * B'), {
      profile: 'scalar', scope
    });
    const right = math.symbolic.canonicalize(math.parse('B * A'), {
      profile: 'scalar', scope
    });

    expect(left.expression.toString()).toBe('A * B');
    expect(right.expression.toString()).toBe('B * A');
    expect(math.symbolic.structure.equals(left.expression, right.expression))
      .toBe(false);
  });

  it('normalizes signs across scalar products', () => {
    const math = createMath();
    const assumptions = realAssumptions(math, 'x', 'y');

    expect(canonicalString(math, '(-x) * (-y)', 'scalar', {assumptions}))
      .toBe('x * y');
    expect(canonicalString(math, '-(2 * x)', 'scalar', {assumptions}))
      .toBe('-2 * x');
    expect(canonicalString(math, '-1 * x', 'presentation', {assumptions}))
      .toBe('-x');
  });

  it('normalizes subtraction and double negation only with scalar evidence', () => {
    const math = createMath();
    const strictSubtraction = math.symbolic.canonicalize(math.parse('x - y'), {
      profile: 'scalar'
    });
    const conditionalSubtraction = math.symbolic.canonicalize(
      math.parse('x - y'),
      {profile: 'scalar', mode: 'conditional'}
    );
    const conditionalAddition = math.symbolic.canonicalize(
      math.parse('x + (-y)'),
      {profile: 'scalar', mode: 'conditional'}
    );
    const structuralNegation = math.symbolic.canonicalize(math.parse('-(-x)'));
    const scalarNegation = math.symbolic.canonicalize(math.parse('-(-x)'), {
      profile: 'scalar', mode: 'conditional'
    });

    expect(strictSubtraction.expression.toString()).toBe('x - y');
    expect(math.symbolic.structure.equals(
      conditionalSubtraction.expression,
      conditionalAddition.expression
    )).toBe(true);
    expect(requirementLabels(conditionalSubtraction.requirements)).toEqual([
      'property:scalar:x',
      'property:scalar:y'
    ]);
    expect(conditionalSubtraction.trace.map((step) => step.rule))
      .toContain('normalize-subtraction');
    expect(structuralNegation.expression.toString()).toBe('-(-x)');
    expect(scalarNegation.expression.toString()).toBe('x');
    expect(requirementLabels(scalarNegation.requirements))
      .toEqual(['property:scalar:x']);
  });
});

describe('identity, annihilator, and power safety', () => {
  it('requires scalar proof before removing additive and multiplicative identities', () => {
    const math = createMath();
    const strict = math.symbolic.canonicalize(math.parse('(x + 0) * 1'), {
      profile: 'scalar'
    });
    const conditional = math.symbolic.canonicalize(math.parse('(x + 0) * 1'), {
      profile: 'scalar', mode: 'conditional'
    });

    expect(strict.expression.toString()).toBe('(x + 0) * 1');
    expect(conditional.expression.toString()).toBe('x');
    expect(requirementLabels(conditional.requirements))
      .toEqual(['property:scalar:x']);
  });

  it('requires scalar defined factors before applying the zero annihilator', () => {
    const math = createMath();
    const strict = math.symbolic.canonicalize(math.parse('0 * x'), {
      profile: 'scalar'
    });
    const conditional = math.symbolic.canonicalize(math.parse('0 * x'), {
      profile: 'scalar', mode: 'conditional'
    });
    const invalid = math.symbolic.canonicalize(math.parse('0 * (1 / 0)'), {
      profile: 'scalar', mode: 'conditional', domain: 'real'
    });

    expect(strict.expression.toString()).toBe('0 * x');
    expect(conditional.expression.toString()).toBe('0');
    expect(requirementLabels(conditional.requirements)).toEqual([
      'property:defined:x',
      'property:scalar:x'
    ]);
    expect(math.symbolic.structure.equals(
      invalid.expression,
      math.parse('0 * (1 / 0)'),
      {parentheses: 'transparent'}
    )).toBe(true);
  });

  it('preserves undefined zero powers and emits nonzero obligations conditionally', () => {
    const math = createMath();
    const strict = math.symbolic.canonicalize(math.parse('x ^ 0'), {
      profile: 'scalar'
    });
    const conditional = math.symbolic.canonicalize(math.parse('x ^ 0'), {
      profile: 'scalar', mode: 'conditional'
    });

    expect(strict.expression.toString()).toBe('x ^ 0');
    expect(conditional.expression.toString()).toBe('1');
    expect(requirementLabels(conditional.requirements))
      .toEqual(['property:nonzero:x']);
    const powerOne = math.symbolic.canonicalize(math.parse('x ^ 1'), {
      profile: 'scalar', mode: 'conditional'
    });
    const onePower = math.symbolic.canonicalize(math.parse('1 ^ x'), {
      profile: 'scalar', mode: 'conditional'
    });

    expect(canonicalString(math, '0 ^ 0', 'scalar', {mode: 'conditional'}))
      .toBe('0 ^ 0');
    expect(canonicalString(math, 'x ^ 1', 'scalar')).toBe('x ^ 1');
    expect(powerOne.expression.toString()).toBe('x');
    expect(requirementLabels(powerOne.requirements))
      .toEqual(['property:scalar:x']);
    expect(onePower.expression.toString()).toBe('1');
    expect(requirementLabels(onePower.requirements)).toEqual([
      'property:defined:x',
      'property:scalar:x'
    ]);
  });

  it('preserves branch-sensitive powers, cancellations, and logarithm combinations', () => {
    const math = createMath();
    const cases = [
      'x / x',
      '(x * y) ^ a',
      'x ^ a * x ^ b',
      'log(x) + log(y)'
    ];

    for (const source of cases) {
      const result = math.symbolic.canonicalize(math.parse(source), {
        profile: 'complex-safe', mode: 'conditional'
      });
      expect(result.expression.toString()).toBe(math.parse(source).toString());
    }
  });
});

describe('real-algebraic and complex-safe profiles', () => {
  it('normalizes a real square root of a square using sign assumptions', () => {
    const math = createMath();
    const x = math.parse('x');
    const real = [assume(math.symbolic.predicates.real(x))];
    const nonnegative = [assume(math.symbolic.predicates.nonnegative(x))];
    const nonpositive = [assume(math.symbolic.predicates.nonpositive(x))];

    expect(canonicalString(math, 'sqrt(x ^ 2)', 'real-algebraic', {
      assumptions: real
    })).toBe('abs(x)');
    expect(canonicalString(math, 'sqrt(x ^ 2)', 'real-algebraic', {
      assumptions: nonnegative
    })).toBe('x');
    expect(canonicalString(math, 'sqrt(x ^ 2)', 'real-algebraic', {
      assumptions: nonpositive
    })).toBe('-x');
    expect(canonicalString(math, 'nthRoot(x ^ 2, 2)', 'real-algebraic', {
      assumptions: real
    })).toBe('abs(x)');
  });

  it('returns an explicit real requirement in conditional mode', () => {
    const math = createMath();
    const result = math.symbolic.canonicalize(math.parse('sqrt(x ^ 2)'), {
      profile: 'real-algebraic', mode: 'conditional'
    });

    expect(result.expression.toString()).toBe('abs(x)');
    expect(requirementLabels(result.requirements)).toEqual(['domain:real:x']);
    expect(result.trace.map((step) => step.rule))
      .toContain('normalize-real-square-root');
  });

  it('does not apply the real identity in the complex-safe profile', () => {
    const math = createMath();
    const complex = math.symbolic.canonicalize(math.parse('sqrt(x ^ 2)'), {
      profile: 'complex-safe',
      mode: 'conditional'
    });
    const invalidReal = math.symbolic.canonicalize(math.parse('sqrt(-1)'), {
      profile: 'real-algebraic'
    });

    const exactComplex = math.symbolic.canonicalize(math.parse('sqrt(-1)'), {
      profile: 'complex-safe'
    });

    expect(complex.expression.toString()).toBe('sqrt(x ^ 2)');
    expect(complex.requirements).toEqual([]);
    expect(invalidReal.expression.toString()).toBe('sqrt(-1)');
    expect(exactComplex.expression.toString()).toBe('i');
  });
});

describe('configured exact constant folding', () => {
  it('folds exact integer arithmetic and exact roots but not approximate roots', () => {
    const math = createMath();

    expect(canonicalString(math, '2 + 3', 'scalar')).toBe('5');
    expect(canonicalString(math, '2 * 3', 'scalar')).toBe('6');
    expect(canonicalString(math, '4 / 2', 'scalar')).toBe('2');
    expect(canonicalString(math, '1 / 2', 'scalar')).toBe('1 / 2');
    expect(canonicalString(math, 'sqrt(4)', 'real-algebraic')).toBe('2');
    expect(canonicalString(math, 'sqrt(2)', 'real-algebraic')).toBe('sqrt(2)');
    expect(canonicalString(math, 'nthRoot(8, 3)', 'real-algebraic')).toBe('2');
    expect(canonicalString(math, 'abs(-2)', 'real-algebraic')).toBe('2');
  });

  it('uses configured BigNumber and Fraction values rather than JavaScript arithmetic', () => {
    const big = createMath({number: 'BigNumber'});
    const fraction = createMath({number: 'Fraction'});
    const bigResult = big.symbolic.canonicalize(big.parse('2 + 3'), {
      profile: 'scalar'
    }).expression;
    const fractionResult = fraction.symbolic.canonicalize(
      fraction.parse('1 / 3 + 2 / 3'),
      {profile: 'scalar'}
    ).expression;

    expect(isConstantNode(bigResult)).toBe(true);
    expect(isConstantNode(fractionResult)).toBe(true);
    if (!isConstantNode(bigResult) || !isConstantNode(fractionResult)) {
      throw new Error('Expected configured constant results');
    }
    expect(big.isBigNumber(bigResult.value)).toBe(true);
    expect(bigResult.toString()).toBe('5');
    expect(fraction.isFraction(fractionResult.value)).toBe(true);
    expect(fraction.equal(fractionResult.value, fraction.fraction(1))).toBe(true);
  });
});

describe('canonicalization determinism, limits, and validation', () => {
  it.each<CanonicalizationProfile>([
    'structural',
    'scalar',
    'real-algebraic',
    'complex-safe',
    'presentation'
  ])('is idempotent for the %s profile', (profile) => {
    const math = createMath();
    const options = {
      profile,
      mode: 'conditional' as const
    };
    const first = math.symbolic.canonicalize(
      math.parse('+((y * 2 + 0 + x * 3))'),
      options
    );
    const second = math.symbolic.canonicalize(first.expression, options);

    expect(math.symbolic.structure.equals(first.expression, second.expression))
      .toBe(true);
    expect(second.changed).toBe(false);
    expect(second.complete).toBe(true);
  });

  it('returns typed step, node, and pass limits', () => {
    const math = createMath();
    const step = math.symbolic.canonicalize(math.parse('+((x))'), {
      maximumSteps: 1
    });
    const node = math.symbolic.canonicalize(math.parse('x + y'), {
      maximumNodes: 1
    });
    const pass = math.symbolic.canonicalize(math.parse('+x'), {
      maximumPasses: 1
    });
    const explicitZeroStep = math.symbolic.canonicalize(math.parse('+x'), {
      limits: {canonicalSteps: 0}
    });

    expect(step.complete).toBe(false);
    expect(step.limit?.limit).toBe('canonicalSteps');
    expect(node.complete).toBe(false);
    expect(node.limit?.limit).toBe('canonicalNodes');
    expect(pass.complete).toBe(false);
    expect(pass.limit?.limit).toBe('canonicalPasses');
    expect(explicitZeroStep.limit?.maximum).toBe(0);
  });

  it('validates profiles, domains, limits, nodes, and scopes', () => {
    const math = createMath();
    const x = math.parse('x');

    expect(() => math.symbolic.canonicalize(null as never)).toThrow(TypeError);
    expect(() => math.symbolic.canonicalize(x, {
      profile: 'bad' as never
    })).toThrow(TypeError);
    expect(() => math.symbolic.canonicalize(x, {
      maximumPasses: 0
    })).toThrow(RangeError);
    expect(() => math.symbolic.canonicalize(x, {
      maximumNodes: 0
    })).toThrow(RangeError);
    expect(() => math.symbolic.canonicalize(x, {
      maximumSteps: 0
    })).toThrow(RangeError);
    expect(() => math.symbolic.canonicalize(x, {
      profile: 'real-algebraic', domain: 'complex'
    })).toThrow(RangeError);
    expect(() => math.symbolic.canonicalize(x, {
      profile: 'complex-safe', domain: 'real'
    })).toThrow(RangeError);
    expect(() => math.symbolic.canonicalize(x, {
      scope: [] as never
    })).toThrow(TypeError);
  });

  it('preserves evaluations for generated scalar expressions', () => {
    const math = createMath();
    const x = math.parse('x');
    const assumptions = [assume(math.symbolic.predicates.real(x))];

    fc.assert(fc.property(
      fc.integer({min: -20, max: 20}),
      fc.integer({min: -20, max: 20}),
      fc.integer({min: -20, max: 20}),
      fc.integer({min: -10, max: 10}),
      (a, b, c, value) => {
        const expression = math.parse(`(${a} * x + ${b}) + ${c}`);
        const canonical = math.symbolic.canonicalize(expression, {
          profile: 'scalar', assumptions
        });
        const scope = {x: value};
        expect(canonical.requirements).toEqual([]);
        expect(canonical.expression.compile().evaluate(scope) ===
          expression.compile().evaluate(scope)).toBe(true);
      }
    ), {numRuns: 100});
  });
});

describe('legacy canonical-key compatibility facade', () => {
  it('uses canonical structural identity for scalar permutations', () => {
    const math = createMath();

    expect(math.symbolicKernel.canonicalKey(math.parse('x + y')))
      .toBe(math.symbolicKernel.canonicalKey(math.parse('y + x')));
    expect(math.symbolicKernel.canonicalKey(math.parse('(x + 0) * 1')))
      .toBe(math.symbolicKernel.canonicalKey(math.parse('x')));
    expect(math.symbolicKernel.canonicalKey(math.parse('x / x')))
      .not.toBe(math.symbolicKernel.canonicalKey(math.parse('1')));
    expect(math.symbolicKernel.canonicalKey(math.parse('0'))).toBe('number:0');
  });
});
