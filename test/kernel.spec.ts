import {all, create, isOperatorNode} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import type {Condition, ConditionKind} from '../src/index.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

describe('SymbolicKernel substitution and simplification', () => {
  it('substitutes a symbol immutably throughout an expression', () => {
    const math = createMath();
    const input = math.parse('x^2 + f(x) + xy');
    const replacement = math.parse('a + 1');
    const output = math.symbolicKernel.substitute(input, 'x', replacement);

    expect(output.toString()).toBe('(a + 1) ^ 2 + f(a + 1) + xy');
    expect(input.toString()).toBe('x ^ 2 + f(x) + xy');
  });

  it('rejects invalid substitution nodes', () => {
    const math = createMath();

    expect(() => math.symbolicKernel.substitute(null as never, 'x', math.parse('1')))
      .toThrow(TypeError);
    expect(() => math.symbolicKernel.substitute(math.parse('x'), 'x', null as never))
      .toThrow(TypeError);
  });

  it('uses conservative simplification without unsafe cancellation', () => {
    const math = createMath();

    expect(math.symbolicKernel.simplify(math.parse('(x + 0) * 1')).toString())
      .toBe('x');
    expect(math.symbolicKernel.simplify(math.parse('x / x')).toString())
      .toBe('x / x');
    expect(math.symbolicKernel.simplify(math.parse('sqrt(-1)')).toString())
      .toBe('sqrt(-1)');
  });

  it('produces stable canonical keys', () => {
    const math = createMath();

    expect(math.symbolicKernel.canonicalKey(math.parse('(x + 0) * 1')))
      .toBe(math.symbolicKernel.canonicalKey(math.parse('x')));
  });
});

describe('domain conditions', () => {
  it('collects division, powers, roots, and logarithms', () => {
    const math = createMath();
    const node = math.parse(
      '1/a + b^(-2) + c^0.5 + sqrt(d) + log(e) + log10(f) + nthRoot(g, 4)'
    );
    const actual = math.symbolicKernel.conditionsForDefinedness(node)
      .map((condition) => condition.kind + ':' + condition.expression.toString());

    expect(actual).toEqual([
      'nonnegative:c',
      'nonnegative:d',
      'nonnegative:g',
      'nonzero:a',
      'nonzero:b',
      'positive:f'
    ]);
  });

  it('does not add even-root conditions for odd or symbolic nthRoot degrees', () => {
    const math = createMath();
    const conditions = math.symbolicKernel.conditionsForDefinedness(
      math.parse('nthRoot(x, 3) + nthRoot(y, n) + z^2')
    );

    expect(conditions).toEqual([]);
  });

  it('ignores symbolic and failing constant power exponents', () => {
    const math = createMath();
    math.import({explode: () => { throw new Error('boom'); }});

    expect(math.symbolicKernel.conditionsForDefinedness(
      math.parse('x^n + y^explode()')
    )).toEqual([]);
  });

  it('preserves an impossible real-domain requirement for callers to normalize', () => {
    const math = createMath();
    const conditions = math.symbolicKernel.conditionsForDefinedness(
      math.parse('sqrt(-1)')
    );

    expect(conditions.map((condition) =>
      condition.kind + ':' + condition.expression.toString()
    )).toEqual(['nonnegative:-1']);
    expect(math.symbolicKernel.normalizeConditions(conditions).contradictory)
      .toBe(true);
  });

  it('rejects non-node conditions', () => {
    const math = createMath();

    expect(() => math.symbolicKernel.condition('zero', null as never))
      .toThrow(TypeError);
  });

  it('deduplicates, sorts, folds constants, and detects contradictions', () => {
    const math = createMath();
    const x = math.parse('x');
    const conditions: Condition[] = [
      math.symbolicKernel.condition('nonzero', x),
      math.symbolicKernel.condition('positive', math.parse('2')),
      math.symbolicKernel.condition('nonzero', x),
      math.symbolicKernel.condition('defined', x)
    ];
    const normalized = math.symbolicKernel.normalizeConditions(conditions);

    expect(normalized.contradictory).toBe(false);
    expect(normalized.conditions.map((condition) => condition.kind))
      .toEqual(['defined', 'nonzero']);
    expect(Object.isFrozen(normalized.conditions)).toBe(true);

    expect(math.symbolicKernel.normalizeConditions([
      math.symbolicKernel.condition('zero', x),
      math.symbolicKernel.condition('nonzero', x)
    ]).contradictory).toBe(true);
    expect(math.symbolicKernel.normalizeConditions([
      math.symbolicKernel.condition('positive', x),
      math.symbolicKernel.condition('nonpositive', x)
    ]).contradictory).toBe(true);
    expect(math.symbolicKernel.normalizeConditions([
      math.symbolicKernel.condition('negative', math.parse('2'))
    ]).contradictory).toBe(true);
  });

  it('normalizes complex zero and definedness conditions', () => {
    const math = createMath();
    const nonzero = new math.ConstantNode(math.complex(0, 2) as never);
    const zero = new math.ConstantNode(math.complex(0, 0) as never);

    expect(math.symbolicKernel.normalizeConditions([
      math.symbolicKernel.condition('nonzero', nonzero),
      math.symbolicKernel.condition('defined', nonzero)
    ])).toEqual({conditions: [], contradictory: false});
    expect(math.symbolicKernel.normalizeConditions([
      math.symbolicKernel.condition('nonzero', zero)
    ]).contradictory).toBe(true);
  });

  it('verifies a complex candidate with a scaled residual comparison', () => {
    const math = createMath();
    const equation = math.parseEquation('x^2 + 1 =:= 0');
    const candidate = new math.ConstantNode(math.complex(0, 1) as never);

    expect(math.symbolicKernel.verify(equation, 'x', candidate))
      .toEqual({status: 'proven'});
  });

  it.each<[ConditionKind, string, boolean]>([
    ['zero', '0', true],
    ['nonzero', '2', true],
    ['positive', '2', true],
    ['nonnegative', '0', true],
    ['negative', '-2', true],
    ['nonpositive', '0', true],
    ['defined', '2', true]
  ])('folds the constant %s condition', (kind, expression, expected) => {
    const math = createMath();
    const normalized = math.symbolicKernel.normalizeConditions([
      math.symbolicKernel.condition(kind, math.parse(expression))
    ]);

    expect(normalized.contradictory).toBe(!expected);
    expect(normalized.conditions).toEqual([]);
  });

  it('folds boolean definedness and rejects non-finite constants', () => {
    const math = createMath();

    expect(math.symbolicKernel.normalizeConditions([
      math.symbolicKernel.condition('defined', math.parse('true'))
    ]).contradictory).toBe(false);
    expect(math.symbolicKernel.normalizeConditions([
      math.symbolicKernel.condition('defined', math.parse('Infinity'))
    ]).contradictory).toBe(true);
  });

  it('folds BigNumber and bigint values', () => {
    const bigMath = importsymbolicjs(create(all!, {number: 'BigNumber'}));
    const normalMath = createMath();

    expect(bigMath.symbolicKernel.normalizeConditions([
      bigMath.symbolicKernel.condition('positive', bigMath.parse('2'))
    ]).contradictory).toBe(false);
    expect(normalMath.symbolicKernel.normalizeConditions([
      normalMath.symbolicKernel.condition(
        'positive',
        new normalMath.ConstantNode(2n)
      )
    ]).contradictory).toBe(false);
  });
});

describe('candidate verification', () => {
  it('proves exact and structurally equal candidates', () => {
    const math = createMath();

    expect(math.symbolicKernel.verify(
      math.parseEquation('x + 1 =:= 3'),
      'x',
      math.parse('2')
    )).toEqual({status: 'proven'});
    expect(math.symbolicKernel.verify(
      math.parseEquation('x =:= y'),
      'x',
      math.parse('y')
    )).toEqual({status: 'proven'});
  });

  it('rejects nonzero residuals and extraneous roots', () => {
    const math = createMath();

    expect(math.symbolicKernel.verify(
      math.parseEquation('x + 1 =:= 3'),
      'x',
      math.parse('3')
    )).toEqual({status: 'rejected', reason: 'numeric-mismatch'});
    expect(math.symbolicKernel.verify(
      math.parseEquation('sqrt(x) =:= -1'),
      'x',
      math.parse('1')
    ).status).toBe('rejected');
  });

  it('handles boolean mismatches and undefined constant candidates', () => {
    const math = createMath();

    expect(math.symbolicKernel.verify(
      math.parseEquation('x =:= true'),
      'x',
      math.parse('false')
    )).toEqual({status: 'rejected', reason: 'numeric-mismatch'});
    expect(math.symbolicKernel.verify(
      math.parseEquation('x =:= missing()'),
      'x',
      math.parse('1')
    )).toEqual({status: 'rejected', reason: 'undefined-candidate'});
  });

  it('classifies a simplified constant residual', () => {
    const math = createMath();
    const kernel = new (math.symbolicKernel.constructor as typeof import('../src/kernel.js').SymbolicKernel)({
      OperatorNode: math.OperatorNode,
      simplifyCore: ((node) =>
        isOperatorNode(node) && node.op === '-'
          ? new math.ConstantNode(0)
          : node) as typeof math.simplifyCore
    });

    expect(kernel.verify(
      math.parseEquation('x + 1 =:= 3'),
      'x',
      math.parse('2')
    )).toEqual({status: 'proven'});
  });

  it('rejects contradictory supplied conditions', () => {
    const math = createMath();
    const condition = math.symbolicKernel.condition('negative', math.parse('1'));

    expect(math.symbolicKernel.verify(
      math.parseEquation('x =:= 1'),
      'x',
      math.parse('1'),
      [condition]
    )).toEqual({status: 'rejected', reason: 'contradictory-conditions'});
  });

  it('marks numeric evidence without proof as inconclusive', () => {
    const math = createMath();
    const result = math.symbolicKernel.verify(
      math.parseEquation('x =:= abs(a)'),
      'x',
      math.parse('sqrt(a^2)')
    );

    expect(result).toEqual({status: 'inconclusive', reason: 'numeric-evidence-only'});
  });

  it('reports when conditions or evaluation provide no valid samples', () => {
    const math = createMath();
    const impossibleSamples = math.symbolicKernel.condition(
      'positive',
      math.parse('a - 10')
    );

    expect(math.symbolicKernel.verify(
      math.parseEquation('x =:= abs(a)'),
      'x',
      math.parse('sqrt(a^2)'),
      [impossibleSamples]
    )).toEqual({status: 'inconclusive', reason: 'no-valid-samples'});
    expect(math.symbolicKernel.verify(
      math.parseEquation('x =:= missing(a)'),
      'x',
      math.parse('1')
    )).toEqual({status: 'inconclusive', reason: 'no-valid-samples'});
  });

  it('rejects parameterized candidates contradicted by samples', () => {
    const math = createMath();
    const result = math.symbolicKernel.verify(
      math.parseEquation('x =:= a + 1'),
      'x',
      math.parse('a + 2')
    );

    expect(result.status).toBe('rejected');
  });

  it('rejects invalid tolerance', () => {
    const math = createMath();

    expect(() => math.symbolicKernel.verify(
      math.parseEquation('x =:= 1'),
      'x',
      math.parse('1'),
      [],
      0
    )).toThrow(RangeError);
  });
});
