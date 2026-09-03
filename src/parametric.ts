import {isSymbolNode} from 'mathjs';
import type {MathJsInstance, MathNode} from 'mathjs';
import {SolverContext} from './budget.js';
import {customFactory} from './custom-factory.js';
import type {SymbolicKernel} from './kernel.js';
import {
  createSearchScope,
  normalizeRealInterval,
  unsupportedResult,
  validateSolveOptions
} from './solve-types.js';
import type {
  Condition,
  IntegerParameter,
  LimitResult,
  ParametricFamily,
  ParametricSolutions,
  PartialResult,
  RealInterval,
  Solution,
  SolveOptions,
  SolveResult,
  VerificationResult
} from './solve-types.js';
import type {EqualityNode} from './types.js';

interface ParametricDependencies {
  ConstantNode: MathJsInstance['ConstantNode'];
  SymbolNode: MathJsInstance['SymbolNode'];
  symbolicKernel: SymbolicKernel;
}

type ParametricInput = ParametricSolutions | (
  PartialResult & {readonly families: readonly ParametricFamily[]}
);

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (
    value &&
    typeof value === 'object' &&
    'toNumber' in value &&
    typeof value.toNumber === 'function'
  ) {
    const converted = value.toNumber();
    return Number.isFinite(converted) ? converted : null;
  }
  return null;
}

function validateParameter(parameter: IntegerParameter): void {
  if (
    !parameter ||
    typeof parameter !== 'object' ||
    typeof parameter.name !== 'string' ||
    parameter.name.length === 0 ||
    parameter.domain !== 'integer'
  ) {
    throw new TypeError('A valid integer parameter is required');
  }
}

export function allocateIntegerParameter(
  usedSymbols: Iterable<string>,
  startIndex = 0
): IntegerParameter {
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
    throw new RangeError('Parameter start index must be a nonnegative safe integer');
  }
  const used = new Set(usedSymbols);
  let index = startIndex;
  while (used.has(`_k${index}`)) {
    index += 1;
    if (!Number.isSafeInteger(index)) {
      throw new RangeError('No safe integer parameter name is available');
    }
  }
  return Object.freeze({name: `_k${index}`, domain: 'integer'});
}

export class ParametricEngine {
  readonly #dependencies: ParametricDependencies;

  constructor(dependencies: ParametricDependencies) {
    this.#dependencies = dependencies;
  }

  #replaceSymbols(
    node: MathNode,
    replacements: ReadonlyMap<string, MathNode>
  ): MathNode {
    return node.transform<MathNode>((candidate) =>
      isSymbolNode(candidate) && replacements.has(candidate.name)
        ? replacements.get(candidate.name)!
        : candidate
    );
  }

  #renamedFamily(
    family: ParametricFamily,
    usedSymbols: readonly string[]
  ): ParametricFamily {
    if (!family?.value?.isNode || family.exact !== true) {
      throw new TypeError('A valid exact parametric family is required');
    }
    const seen = new Set<string>();
    const replacements = new Map<string, MathNode>();
    const parameters: IntegerParameter[] = [];
    for (const parameter of family.parameters) {
      validateParameter(parameter);
      if (seen.has(parameter.name)) {
        throw new TypeError(`Duplicate integer parameter: ${parameter.name}`);
      }
      seen.add(parameter.name);
      const canonical = allocateIntegerParameter(
        [...usedSymbols, ...parameters.map((value) => value.name)]
      );
      parameters.push(canonical);
      replacements.set(
        parameter.name,
        new this.#dependencies.SymbolNode(canonical.name)
      );
    }
    const conditions = family.conditions.map((condition) => Object.freeze({
      kind: condition.kind,
      expression: this.#replaceSymbols(condition.expression, replacements)
    }));
    return Object.freeze({
      value: this.#dependencies.symbolicKernel.simplify(
        this.#replaceSymbols(family.value, replacements)
      ),
      parameters: Object.freeze(parameters),
      conditions: this.#dependencies.symbolicKernel.normalizeConditions(conditions).conditions,
      exact: true,
      verification: Object.freeze({...family.verification}),
      ...(family.certificate === undefined ? {} : {certificate: Object.freeze({
        ...family.certificate,
        period: this.#replaceSymbols(family.certificate.period, replacements),
        inner: this.#replaceSymbols(family.certificate.inner, replacements)
      })})
    });
  }

  canonicalizeFamilies(
    families: readonly ParametricFamily[],
    usedSymbols: readonly string[] = []
  ): readonly ParametricFamily[] {
    const unique = new Map<string, ParametricFamily>();
    for (const family of families) {
      const normalized = this.#renamedFamily(family, usedSymbols);
      const key = [
        this.#dependencies.symbolicKernel.canonicalKey(normalized.value),
        normalized.parameters.map((parameter) => parameter.domain).join(','),
        normalized.conditions.map((condition) =>
          `${condition.kind}:${this.#dependencies.symbolicKernel.canonicalKey(
            condition.expression
          )}`
        ).join(',')
      ].join('|');
      unique.set(key, normalized);
    }
    return Object.freeze([...unique.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, family]) => family));
  }

  instantiateFamily(
    family: ParametricFamily,
    assignments: Readonly<Record<string, number>>
  ): MathNode {
    if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) {
      throw new TypeError('Integer parameter assignments must be an object');
    }
    const names = family.parameters.map((parameter) => {
      validateParameter(parameter);
      return parameter.name;
    }).sort();
    const supplied = Object.keys(assignments).sort();
    if (
      names.length !== supplied.length ||
      names.some((name, index) => name !== supplied[index])
    ) {
      throw new TypeError('Integer parameter assignments do not match the family');
    }
    const replacements = new Map<string, MathNode>();
    for (const name of names) {
      const value = assignments[name];
      if (!Number.isSafeInteger(value)) {
        throw new TypeError(`Parameter ${name} must be a safe integer`);
      }
      replacements.set(name, new this.#dependencies.ConstantNode(value));
    }
    return this.#dependencies.symbolicKernel.simplify(
      this.#replaceSymbols(family.value, replacements)
    );
  }

  verifyFamilySamples(
    equation: EqualityNode,
    target: string,
    family: ParametricFamily,
    integers: readonly number[] = [-2, -1, 0, 1, 2]
  ): VerificationResult {
    if (!equation?.isEqualityNode) {
      throw new TypeError('EqualityNode expected');
    }
    if (family.parameters.length !== 1) {
      return Object.freeze({
        status: 'inconclusive',
        reason: 'sample-verification-requires-one-parameter'
      });
    }
    const parameter = family.parameters[0]!;
    for (const integer of integers) {
      if (!Number.isSafeInteger(integer)) {
        throw new TypeError('Family sample values must be safe integers');
      }
      const candidate = this.instantiateFamily(family, {[parameter.name]: integer});
      const verification = this.#dependencies.symbolicKernel.verify(
        equation,
        target,
        candidate,
        family.conditions
      );
      if (verification.status === 'rejected') {
        return Object.freeze({
          status: 'rejected',
          reason: `family-sample-${integer}:${verification.reason ?? 'mismatch'}`,
          evidence: Object.freeze({method: 'sample'})
        });
      }
    }
    return Object.freeze({
      status: 'inconclusive',
      reason: 'finite-family-samples-only',
      evidence: Object.freeze({method: 'sample'})
    });
  }

  #instantiateConditions(
    family: ParametricFamily,
    assignments: Readonly<Record<string, number>>
  ): readonly Condition[] {
    const replacements = new Map<string, MathNode>();
    for (const [name, value] of Object.entries(assignments)) {
      replacements.set(name, new this.#dependencies.ConstantNode(value));
    }
    return this.#dependencies.symbolicKernel.normalizeConditions(
      family.conditions.map((condition) => ({
        kind: condition.kind,
        expression: this.#replaceSymbols(condition.expression, replacements)
      }))
    ).conditions;
  }

  #numericValue(node: MathNode, scope: Readonly<Record<string, unknown>>): number | null {
    try {
      return asFiniteNumber(node.compile().evaluate(scope));
    } catch {
      return null;
    }
  }

  #inside(value: number, interval: RealInterval, tolerance: number): boolean {
    const scale = Math.max(1, Math.abs(value), Math.abs(interval.lower), Math.abs(interval.upper));
    const epsilon = tolerance * scale;
    const aboveLower = interval.includeLower
      ? value >= interval.lower - epsilon
      : value > interval.lower + epsilon;
    const belowUpper = interval.includeUpper
      ? value <= interval.upper + epsilon
      : value < interval.upper - epsilon;
    return aboveLower && belowUpper;
  }

  materializeSolutions(
    result: ParametricInput,
    suppliedInterval: RealInterval,
    scope: Readonly<Record<string, unknown>> = {},
    options?: SolveOptions
  ): SolveResult {
    validateSolveOptions(options);
    if (!result || (result.kind !== 'parametric' && result.kind !== 'partial')) {
      throw new TypeError('A parametric or partial family result is required');
    }
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
      throw new TypeError('Materialization scope must be an object');
    }
    const interval = normalizeRealInterval(suppliedInterval);
    const context = new SolverContext(result.target, options);
    const familyLimit = context.consume('parametric-families', result.families.length);
    if (familyLimit) {
      return familyLimit;
    }
    const tolerance = options?.tolerance ?? 1e-12;
    const candidates: {solution: Solution; numeric: number}[] = [];

    for (const family of result.families) {
      if (family.parameters.length !== 1) {
        return unsupportedResult(result.target, 'unsupported-structure');
      }
      const parameter = family.parameters[0]!;
      const values = [0, 1, 2].map((integer) => this.#numericValue(
        this.instantiateFamily(family, {[parameter.name]: integer}),
        scope
      ));
      if (values.some((value) => value === null)) {
        return unsupportedResult(result.target, 'unsupported-structure');
      }
      const offset = values[0]!;
      const slope = values[1]! - offset;
      const secondDifference = Math.abs(values[2]! - (offset + 2 * slope));
      if (secondDifference > tolerance * Math.max(1, Math.abs(values[2]!))) {
        return unsupportedResult(result.target, 'unsupported-structure');
      }

      let integers: number[];
      if (Math.abs(slope) <= tolerance * Math.max(1, Math.abs(offset))) {
        integers = this.#inside(offset, interval, tolerance) ? [0] : [];
      } else {
        const first = (interval.lower - offset) / slope;
        const second = (interval.upper - offset) / slope;
        let lower = Math.ceil(Math.min(first, second)) - 1;
        let upper = Math.floor(Math.max(first, second)) + 1;
        if (!Number.isSafeInteger(lower) || !Number.isSafeInteger(upper)) {
          return Object.freeze({
            kind: 'limit',
            target: result.target,
            limit: 'candidates'
          }) as LimitResult;
        }
        const possible = upper - lower + 1;
        if (possible > context.limits.candidates + 2) {
          return Object.freeze({
            kind: 'limit',
            target: result.target,
            limit: 'candidates'
          }) as LimitResult;
        }
        integers = [];
        for (let integer = lower; integer <= upper; integer += 1) {
          const numeric = offset + slope * integer;
          if (this.#inside(numeric, interval, tolerance)) {
            integers.push(integer);
          }
        }
      }

      for (const integer of integers) {
        const limit = context.consume('candidates') ?? context.consume('total-work');
        if (limit) {
          return limit;
        }
        const assignments = {[parameter.name]: integer};
        const value = this.instantiateFamily(family, assignments);
        const numeric = this.#numericValue(value, scope);
        if (numeric === null || !this.#inside(numeric, interval, tolerance)) {
          continue;
        }
        candidates.push({
          numeric,
          solution: Object.freeze({
            value,
            conditions: this.#instantiateConditions(family, assignments),
            exact: true,
            verification: family.verification
          })
        });
      }
    }

    const unique = new Map<string, {solution: Solution; numeric: number}>();
    for (const candidate of candidates) {
      unique.set(this.#dependencies.symbolicKernel.canonicalKey(candidate.solution.value), candidate);
    }
    const solutions = Object.freeze([...unique.values()]
      .sort((left, right) => left.numeric - right.numeric)
      .map((candidate) => candidate.solution));
    const resultScope = createSearchScope(
      'real',
      result.kind === 'parametric' ? 'complete-in-interval' : 'partial',
      interval
    );
    if (result.kind === 'partial') {
      return Object.freeze({
        kind: 'partial',
        target: result.target,
        solutions,
        families: result.families,
        remainder: result.remainder,
        reason: result.reason,
        scope: resultScope
      });
    }
    if (solutions.length === 0) {
      return Object.freeze({
        kind: 'contradiction',
        target: result.target,
        conditions: Object.freeze([]),
        scope: resultScope
      });
    }
    return Object.freeze({
      kind: 'finite',
      target: result.target,
      solutions,
      scope: resultScope
    });
  }
}

export const createCanonicalizeParametricFamilies = customFactory(
  'canonicalizeParametricFamilies',
  ['ConstantNode', 'SymbolNode', 'symbolicKernel'],
  (rawDependencies) => {
    const engine = new ParametricEngine(rawDependencies as unknown as ParametricDependencies);
    return (
      families: readonly ParametricFamily[],
      usedSymbols?: readonly string[]
    ) => engine.canonicalizeFamilies(families, usedSymbols);
  }
);

export const createInstantiateFamily = customFactory(
  'instantiateFamily',
  ['ConstantNode', 'SymbolNode', 'symbolicKernel'],
  (rawDependencies) => {
    const engine = new ParametricEngine(rawDependencies as unknown as ParametricDependencies);
    return (
      family: ParametricFamily,
      assignments: Readonly<Record<string, number>>
    ) => engine.instantiateFamily(family, assignments);
  }
);

export const createMaterializeSolutions = customFactory(
  'materializeSolutions',
  ['ConstantNode', 'SymbolNode', 'symbolicKernel'],
  (rawDependencies) => {
    const engine = new ParametricEngine(rawDependencies as unknown as ParametricDependencies);
    return (
      result: ParametricInput,
      interval: RealInterval,
      scope?: Readonly<Record<string, unknown>>,
      options?: SolveOptions
    ) => engine.materializeSolutions(result, interval, scope, options);
  }
);

export const createVerifyParametricFamily = customFactory(
  'verifyParametricFamily',
  ['ConstantNode', 'SymbolNode', 'symbolicKernel'],
  (rawDependencies) => {
    const engine = new ParametricEngine(rawDependencies as unknown as ParametricDependencies);
    return (
      equation: EqualityNode,
      target: string,
      family: ParametricFamily,
      integers?: readonly number[]
    ) => engine.verifyFamilySamples(equation, target, family, integers);
  }
);
