import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs, isEqualityNode} from '../src/index.js';
import type {
  Condition,
  SolveOptions,
  SolveResult,
  symbolicjsInstance
} from '../src/index.js';
import {
  loadConformanceFixtures,
  parseConformanceFixtures,
  rootSetsMatch
} from './support/acceptance.js';
import type {
  ComplexValue,
  ConformanceFixture
} from './support/acceptance.js';

const cases = loadConformanceFixtures(
  new URL('./fixtures/conformance.json', import.meta.url)
);

function createMath() {
  const math = create(all!);
  math.import({
    tauConstant: 2 * Math.PI,
    triple: (value: number) => 3 * value
  });
  return importsymbolicjs(math);
}

function options(fixture: ConformanceFixture, diagnostics = false): SolveOptions {
  return {
    ...(fixture.domain === undefined ? {} : {domain: fixture.domain}),
    ...(fixture.interval === undefined ? {} : {interval: fixture.interval}),
    ...(fixture.numericFallback === undefined
      ? {}
      : {numericFallback: fixture.numericFallback}),
    ...(fixture.tolerance === undefined ? {} : {tolerance: fixture.tolerance}),
    ...(diagnostics ? {diagnostics: true} : {})
  };
}

function scalar(value: unknown): number | ComplexValue {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (
    value &&
    typeof value === 'object' &&
    're' in value &&
    'im' in value &&
    typeof value.re === 'number' &&
    typeof value.im === 'number' &&
    Number.isFinite(value.re) &&
    Number.isFinite(value.im)
  ) {
    return {re: value.re, im: value.im};
  }
  throw new TypeError('Conformance solution did not evaluate to a finite scalar');
}

function resultConditions(result: SolveResult): readonly Condition[] {
  if (result.kind === 'identity' || result.kind === 'contradiction') {
    return result.conditions;
  }
  if (result.kind === 'finite') {
    return result.solutions.flatMap((solution) => solution.conditions);
  }
  if (result.kind === 'parametric') {
    return result.families.flatMap((family) => family.conditions);
  }
  if (result.kind === 'partial') {
    return [
      ...result.solutions.flatMap((solution) => solution.conditions),
      ...(result.families ?? []).flatMap((family) => family.conditions)
    ];
  }
  return [];
}

function resultCompleteness(result: SolveResult): string | undefined {
  return result.kind === 'parametric'
    ? result.completeness
    : result.scope?.completeness;
}

function assertFrozenResult(result: SolveResult): void {
  expect(Object.isFrozen(result)).toBe(true);
  if (result.scope) {
    expect(Object.isFrozen(result.scope)).toBe(true);
  }
  if (result.kind === 'finite' || result.kind === 'partial') {
    expect(Object.isFrozen(result.solutions)).toBe(true);
    for (const solution of result.solutions) {
      expect(Object.isFrozen(solution)).toBe(true);
      expect(Object.isFrozen(solution.conditions)).toBe(true);
      expect(Object.isFrozen(solution.verification)).toBe(true);
    }
  }
  if (result.kind === 'parametric' || (
    result.kind === 'partial' && result.families
  )) {
    const families = result.kind === 'parametric' ? result.families : result.families!;
    expect(Object.isFrozen(families)).toBe(true);
    expect(families.every(Object.isFrozen)).toBe(true);
  }
}

function semanticSnapshot(result: SolveResult): unknown {
  return {
    kind: result.kind,
    reason: result.kind === 'unsupported' || result.kind === 'partial'
      ? result.reason
      : undefined,
    values: result.kind === 'finite' || result.kind === 'partial'
      ? result.solutions.map((solution) => solution.value.toString())
      : undefined,
    families: result.kind === 'parametric'
      ? result.families.map((family) => family.value.toString())
      : result.kind === 'partial'
        ? result.families?.map((family) => family.value.toString())
        : undefined,
    conditions: resultConditions(result).map((condition) =>
      condition.kind + ':' + condition.expression.toString()
    ),
    completeness: resultCompleteness(result)
  };
}

describe('framework-neutral public conformance corpus', () => {
  it('is classified by mathematical feature with explicit semantic assertions', () => {
    expect(cases).toHaveLength(20);
    expect(new Set(cases.map((fixture) => fixture.feature)).size)
      .toBe(cases.length);
    expect(cases.every((fixture) => Object.keys(fixture.assertions).length > 0))
      .toBe(true);
    expect(cases.filter((fixture) => fixture.expectedKind === 'unsupported')
      .every((fixture) => fixture.assertions.reason)).toBe(true);
    expect(Object.isFrozen(cases)).toBe(true);
    expect(cases.every((fixture) => Object.isFrozen(fixture.assertions))).toBe(true);
  });

  it.each(cases)('$feature: $id', (fixture) => {
    const math = createMath();
    const equation = math.parseEquation(fixture.equation);
    const before = JSON.stringify(equation);
    const result = math.solveEquation(equation, fixture.target, options(fixture));
    const tolerance = fixture.tolerance ?? 1e-10;

    expect(result.kind).toBe(fixture.expectedKind);
    expect(JSON.stringify(equation)).toBe(before);
    assertFrozenResult(result);

    if (fixture.assertions.reason !== undefined) {
      expect(
        result.kind === 'unsupported' || result.kind === 'partial'
          ? result.reason
          : undefined
      ).toBe(fixture.assertions.reason);
    }
    if (fixture.assertions.roots !== undefined) {
      expect(result.kind === 'finite' || result.kind === 'partial').toBe(true);
      const solutions = result.kind === 'finite' || result.kind === 'partial'
        ? result.solutions
        : [];
      expect(rootSetsMatch(
        solutions.map((solution) => scalar(solution.value.compile().evaluate())),
        fixture.assertions.roots,
        tolerance
      )).toBe(true);
      if (fixture.assertions.multiplicities) {
        expect(solutions.map((solution) => solution.multiplicity ?? 1))
          .toEqual(fixture.assertions.multiplicities);
      }
    }
    if (fixture.assertions.familyCount !== undefined) {
      const families = result.kind === 'parametric'
        ? result.families
        : result.kind === 'partial'
          ? result.families ?? []
          : [];
      expect(families).toHaveLength(fixture.assertions.familyCount);
    }
    if (fixture.assertions.conditionKinds !== undefined) {
      expect([...new Set(resultConditions(result).map((condition) => condition.kind))]
        .sort()).toEqual([...fixture.assertions.conditionKinds].sort());
    }
    if (fixture.assertions.completeness !== undefined) {
      expect(resultCompleteness(result)).toBe(fixture.assertions.completeness);
    }

    if (fixture.assertions.serialize) {
      const restored = JSON.parse(JSON.stringify(equation), math.reviver);
      expect(isEqualityNode(restored)).toBe(true);
      expect(restored.equals(equation)).toBe(true);
      expect(semanticSnapshot(
        math.solveEquation(restored, fixture.target, options(fixture))
      )).toEqual(semanticSnapshot(result));
    }
  });

  it.each(cases)('has deterministic diagnostics: $id', (fixture) => {
    const math = createMath();
    const first = math.solveEquation(fixture.equation, fixture.target, options(fixture, true));
    const second = math.solveEquation(fixture.equation, fixture.target, options(fixture, true));

    expect(second.diagnostics).toEqual(first.diagnostics);
    expect(first.diagnostics?.steps.every((step) =>
      !JSON.stringify(step).includes('[object ')
    )).toBe(true);
  });

  it('validates conformance-only fields', () => {
    const base = {
      id: 'fixture', feature: 'feature', equation: 'x =:= 1', target: 'x',
      expectedKind: 'finite', assertions: {roots: [1]},
      provenance: {kind: 'independent', source: 'test'}
    };

    expect(() => parseConformanceFixtures([{...base, feature: ''}]))
      .toThrow('feature');
    expect(() => parseConformanceFixtures([{...base, numericFallback: 1}]))
      .toThrow('numericFallback');
    expect(() => parseConformanceFixtures([{...base, assertions: {roots: [Infinity]}}]))
      .toThrow('finite');
    expect(() => parseConformanceFixtures([{
      ...base,
      assertions: {roots: [1], multiplicities: [1, 2]}
    }])).toThrow('align');
    expect(() => parseConformanceFixtures([{
      ...base,
      assertions: {completeness: 'absolute'}
    }])).toThrow('completeness');
  });
});

describe('configured MathJS conformance', () => {
  it('does not classify configured constants or function names as equation members', () => {
    const math = createMath();
    const equation = math.parseEquation('x =:= tauConstant + triple(2)');

    expect(math.equationSymbols(equation)).toEqual(['x']);
    expect([...math.solveEquationForAll(equation).keys()]).toEqual(['x']);
  });
});
