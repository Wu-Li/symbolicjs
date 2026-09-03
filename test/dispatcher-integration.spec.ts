import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {
  importsymbolicjs,
  mergePartialSolveResults,
  solveEquation
} from '../src/index.js';
import type {
  ParametricFamily,
  PartialResult,
  Solution,
  SolveResult
} from '../src/index.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

function rules(result: SolveResult): string[] {
  return result.diagnostics?.steps
    .filter((step) => step.stage === 'dispatch')
    .map((step) => step.rule) ?? [];
}

describe('end-to-end dispatcher precedence', () => {
  it.each([
    ['x + 1 =:= 2', {}, ['single-occurrence-isolation']],
    ['sin(x) =:= 0', {}, ['single-occurrence-isolation', 'trigonometric']],
    ['x*x - 1 =:= 0', {}, [
      'single-occurrence-isolation',
      'trigonometric',
      'compound-trigonometric',
      'rational-polynomial'
    ]],
    ['x^5 - x =:= 0', {}, [
      'single-occurrence-isolation',
      'trigonometric',
      'compound-trigonometric',
      'numeric-polynomial'
    ]],
    ['sin(x) =:= x/2', {
      numericFallback: true,
      interval: {lower: -2, upper: 2}
    }, [
      'single-occurrence-isolation',
      'trigonometric',
      'compound-trigonometric',
      'rational-polynomial',
      'bounded-numeric-search'
    ]]
  ] as const)('dispatches %s in documented order', (source, options, expected) => {
    const result = createMath().solveEquation(source, 'x', {
      ...options,
      diagnostics: true
    });

    expect(rules(result).slice(0, expected.length)).toEqual(expected);
  });

  it('does not replace exact or parametric success when fallback is enabled', () => {
    const math = createMath();
    for (const source of [
      'exp(x) =:= 3',
      'sin(x) =:= 1/2',
      'x^3 =:= a'
    ]) {
      expect(math.solveEquation(source, 'x', {
        numericFallback: true,
        interval: {lower: -10, upper: 10}
      })).toEqual(math.solveEquation(source, 'x'));
    }
  });
});

describe('partial-result merging', () => {
  it('deduplicates finite candidates, retains families, and keeps the remainder', () => {
    const math = createMath();
    const equation = math.parseEquation('x =:= 1');
    const solution: Solution = Object.freeze({
      value: math.parse('1'),
      conditions: Object.freeze([]),
      exact: true,
      verification: Object.freeze({status: 'proven'})
    });
    const family: ParametricFamily = Object.freeze({
      value: math.parse('2*pi*_k0'),
      parameters: Object.freeze([Object.freeze({name: '_k0', domain: 'integer'})]),
      conditions: Object.freeze([]),
      exact: true,
      verification: Object.freeze({status: 'proven'})
    });
    const withFamily: PartialResult = Object.freeze({
      kind: 'partial',
      target: 'x',
      solutions: Object.freeze([solution]),
      families: Object.freeze([family]),
      remainder: equation,
      reason: 'verification-inconclusive'
    });
    const duplicateCandidate: PartialResult = Object.freeze({
      kind: 'partial',
      target: 'x',
      solutions: Object.freeze([solution]),
      remainder: equation,
      reason: 'verification-inconclusive'
    });
    const unsupported = Object.freeze({
      kind: 'unsupported' as const,
      target: 'x',
      reason: 'no-rule' as const
    });
    const dependencies = {
      equationSymbols: () => Object.freeze(['x']),
      parseEquation: () => equation,
      isolateEquation: () => unsupported,
      trigonometricSolve: () => withFamily,
      compoundTrigonometricSolve: () => duplicateCandidate,
      polynomialSolve: () => unsupported,
      numericSolve: () => unsupported
    };

    const result = solveEquation(dependencies, equation, 'x', {diagnostics: true});

    expect(result.kind).toBe('partial');
    expect((result as PartialResult).solutions).toEqual([solution]);
    expect((result as PartialResult).families).toEqual([family]);
    expect((result as PartialResult).remainder).toBe(equation);
    expect(result.diagnostics?.steps.some((step) =>
      step.rule === 'merge-partial-results' && step.outcome === '2'
    )).toBe(true);
  });

  it('preserves a single partial object and rejects an empty merge', () => {
    const math = createMath();
    const equation = math.parseEquation('x =:= 1');
    const result: PartialResult = Object.freeze({
      kind: 'partial',
      target: 'x',
      solutions: Object.freeze([]),
      remainder: equation,
      reason: 'verification-inconclusive'
    });

    expect(mergePartialSolveResults(equation, 'x', [result])).toBe(result);
    expect(() => mergePartialSolveResults(equation, 'x', []))
      .toThrow('At least one');
  });
});

describe('solver state isolation', () => {
  it('does not leak limits, domains, or intervals across concurrent call scheduling', async () => {
    const math = createMath();
    const workloads = [
      () => math.solveEquation('x^5 - 1 =:= 0', 'x', {domain: 'complex'}),
      () => math.solveEquation('sin(x) =:= x/2', 'x', {
        numericFallback: true,
        interval: {lower: -2, upper: 2}
      }),
      () => math.solveEquation('x^5 - x =:= 0', 'x', {
        limits: {numericIterations: 0}
      }),
      () => math.solveEquation('sin(x) =:= 0', 'x')
    ];
    const expected = workloads.map((workload) => workload());

    const actual = await Promise.all(Array.from({length: 20}, (_, index) =>
      Promise.resolve().then(workloads[index % workloads.length]!)
    ));

    actual.forEach((result, index) => {
      expect(result).toEqual(expected[index % expected.length]);
    });
  });
});
