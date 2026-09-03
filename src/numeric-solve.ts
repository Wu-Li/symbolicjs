import type {MathJsInstance, MathNode} from 'mathjs';
import {SolverContext} from './budget.js';
import {customFactory} from './custom-factory.js';
import type {SymbolicKernel} from './kernel.js';
import {
  createSearchScope,
  normalizeRealInterval,
  unsupportedResult
} from './solve-types.js';
import type {
  Condition,
  LimitResult,
  PartialResult,
  Solution,
  SolveDiagnostics,
  SolveOptions,
  SolveResult,
  SolveTraceStep,
  VerificationMethod
} from './solve-types.js';
import type {EqualityNode} from './types.js';

interface NumericSolveDependencies {
  ConstantNode: MathJsInstance['ConstantNode'];
  OperatorNode: MathJsInstance['OperatorNode'];
  symbolicKernel: SymbolicKernel;
}

interface Sample {
  readonly x: number;
  readonly value: number | null;
}

interface Candidate {
  readonly value: number;
  readonly method: VerificationMethod;
  readonly bracket?: readonly [number, number];
}

export function numericSearchValue(value: unknown): number | null {
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

export function numericSearchConditionHolds(
  condition: Condition,
  scope: Record<string, number>
): boolean {
  let value: unknown;
  try {
    value = condition.expression.compile().evaluate(scope);
  } catch {
    return false;
  }
  const numeric = numericSearchValue(value);
  switch (condition.kind) {
    case 'zero': return numeric === 0;
    case 'nonzero': return numeric !== null && numeric !== 0;
    case 'positive': return numeric !== null && numeric > 0;
    case 'nonnegative': return numeric !== null && numeric >= 0;
    case 'negative': return numeric !== null && numeric < 0;
    case 'nonpositive': return numeric !== null && numeric <= 0;
    case 'defined': return numeric !== null || typeof value === 'boolean';
  }
}

export function numericSearchConditionSafelyHolds(
  condition: Condition,
  scope: Record<string, number>,
  tolerance: number
): boolean {
  let value: unknown;
  try {
    value = condition.expression.compile().evaluate(scope);
  } catch {
    return false;
  }
  const numeric = numericSearchValue(value);
  const margin = Math.sqrt(tolerance) * (1 + Math.abs(scope[Object.keys(scope)[0]!] ?? 0));
  switch (condition.kind) {
    case 'zero': return numeric !== null && Math.abs(numeric) <= tolerance;
    case 'nonzero': return numeric !== null && Math.abs(numeric) > margin;
    case 'positive': return numeric !== null && numeric > margin;
    case 'nonnegative': return numeric !== null && numeric >= -tolerance;
    case 'negative': return numeric !== null && numeric < -margin;
    case 'nonpositive': return numeric !== null && numeric <= tolerance;
    case 'defined': return numeric !== null || typeof value === 'boolean';
  }
}

export class NumericSolveEngine {
  readonly #dependencies: NumericSolveDependencies;
  #context!: SolverContext;
  #limit: LimitResult | null = null;
  #evaluations = 0;
  #invalidEvaluations = 0;
  #subdivisions = 0;
  #brackets = 0;
  #rejected = 0;

  constructor(dependencies: NumericSolveDependencies) {
    this.#dependencies = dependencies;
  }

  #diagnostics(enabled: boolean): SolveDiagnostics | undefined {
    if (!enabled) {
      return undefined;
    }
    const steps: SolveTraceStep[] = [
      Object.freeze({
        stage: 'analysis',
        rule: 'numeric-evaluations',
        outcome: String(this.#evaluations)
      }),
      Object.freeze({
        stage: 'analysis',
        rule: 'numeric-invalid-evaluations',
        outcome: String(this.#invalidEvaluations)
      }),
      Object.freeze({
        stage: 'analysis',
        rule: 'numeric-subdivisions',
        outcome: String(this.#subdivisions)
      }),
      Object.freeze({
        stage: 'analysis',
        rule: 'numeric-brackets',
        outcome: String(this.#brackets)
      }),
      Object.freeze({
        stage: 'analysis',
        rule: 'numeric-rejected-candidates',
        outcome: String(this.#rejected)
      }),
      Object.freeze({
        stage: 'analysis',
        rule: 'numeric-completeness',
        outcome: 'partial'
      })
    ];
    return Object.freeze({steps: Object.freeze(steps)});
  }

  #refineBracket(
    left: Sample,
    right: Sample,
    evaluate: (value: number) => Sample,
    tolerance: number
  ): Candidate | null {
    if (left.value === null || right.value === null || left.value * right.value > 0) {
      return null;
    }
    let low = left;
    let high = right;
    const originalBracket = Object.freeze([low.x, high.x]) as readonly [number, number];
    for (;;) {
      this.#limit ??= this.#context.consume('numeric-iterations');
      this.#limit ??= this.#context.consume('total-work');
      if (this.#limit) {
        return null;
      }
      const midpoint = low.x + (high.x - low.x) / 2;
      const middle = evaluate(midpoint);
      if (middle.value === null) {
        return null;
      }
      if (
        Math.abs(middle.value) <= tolerance ||
        high.x - low.x <= tolerance * (1 + Math.abs(midpoint))
      ) {
        return {value: midpoint, method: 'bracket', bracket: originalBracket};
      }
      if (low.value! * middle.value <= 0) {
        high = middle;
      } else {
        low = middle;
      }
    }
  }

  #refineMinimum(
    left: number,
    right: number,
    evaluate: (value: number) => Sample,
    tolerance: number
  ): Candidate | null {
    let low = left;
    let high = right;
    for (let iteration = 0; iteration < 48; iteration += 1) {
      this.#limit ??= this.#context.consume('numeric-iterations');
      this.#limit ??= this.#context.consume('total-work', 2);
      if (this.#limit) {
        return null;
      }
      const firstX = low + (high - low) / 3;
      const secondX = high - (high - low) / 3;
      const first = evaluate(firstX);
      const second = evaluate(secondX);
      if (first.value === null || second.value === null) {
        return null;
      }
      if (Math.abs(first.value) <= Math.abs(second.value)) {
        high = secondX;
      } else {
        low = firstX;
      }
    }
    const value = low + (high - low) / 2;
    const sample = evaluate(value);
    return sample.value !== null && Math.abs(sample.value) <= Math.sqrt(tolerance)
      ? {value, method: 'sample'}
      : null;
  }

  solve(equation: EqualityNode, target: string, options?: SolveOptions): SolveResult {
    if (!options?.numericFallback) {
      return unsupportedResult(target, 'no-rule');
    }
    if ((options.domain ?? 'real') !== 'real') {
      return unsupportedResult(target, 'unsupported-domain');
    }
    if (!options.interval) {
      return unsupportedResult(target, 'interval-required');
    }
    const interval = normalizeRealInterval(options.interval);
    const tolerance = options.tolerance ?? 1e-12;
    this.#context = new SolverContext(target, options);
    this.#limit = this.#context.preflight(equation);
    if (this.#limit) {
      return this.#limit;
    }
    this.#evaluations = 0;
    this.#invalidEvaluations = 0;
    this.#subdivisions = 0;
    this.#brackets = 0;
    this.#rejected = 0;

    const residual: MathNode = new this.#dependencies.OperatorNode(
      '-',
      'subtract',
      [equation.lhs, equation.rhs]
    );
    const compiled = residual.compile();
    const domainConditions = this.#dependencies.symbolicKernel.normalizeConditions([
      ...this.#dependencies.symbolicKernel.conditionsForDefinedness(equation.lhs),
      ...this.#dependencies.symbolicKernel.conditionsForDefinedness(equation.rhs)
    ]);
    if (domainConditions.contradictory) {
      return Object.freeze({kind: 'contradiction', target, conditions: Object.freeze([])});
    }
    const cache = new Map<string, Sample>();
    const evaluate = (x: number): Sample => {
      const key = x.toPrecision(17);
      const existing = cache.get(key);
      if (existing) {
        return existing;
      }
      this.#limit ??= this.#context.consume('function-evaluations');
      this.#limit ??= this.#context.consume('total-work');
      if (this.#limit) {
        const limited = Object.freeze({x, value: null});
        cache.set(key, limited);
        return limited;
      }
      this.#evaluations += 1;
      const scope = {[target]: x};
      let value: number | null = null;
      if (domainConditions.conditions.every((condition) =>
        numericSearchConditionHolds(condition, scope)
      )) {
        try {
          value = numericSearchValue(compiled.evaluate(scope));
        } catch {
          value = null;
        }
      }
      if (value === null) {
        this.#invalidEvaluations += 1;
      }
      const sample = Object.freeze({x, value});
      cache.set(key, sample);
      return sample;
    };

    const brackets: [Sample, Sample][] = [];
    const minimumDepth = 6;
    const maximumDepth = 10;
    const inspect = (leftX: number, rightX: number, depth: number): void => {
      if (this.#limit) {
        return;
      }
      const midpointX = leftX + (rightX - leftX) / 2;
      const left = evaluate(leftX);
      const middle = evaluate(midpointX);
      const right = evaluate(rightX);
      if (this.#limit) {
        return;
      }
      const values = [left.value, middle.value, right.value];
      const invalid = values.some((value) => value === null);
      const allInvalid = values.every((value) => value === null);
      const finiteValues = values.filter((value): value is number => value !== null);
      const scale = Math.max(tolerance, ...finiteValues.map(Math.abs));
      const curvature = invalid
        ? Number.POSITIVE_INFINITY
        : Math.abs(middle.value! - (left.value! + right.value!) / 2) / scale;
      const valley = !invalid && Math.abs(middle.value!) <
        0.4 * Math.min(Math.abs(left.value!), Math.abs(right.value!));
      const nearZero = !invalid && Math.min(...finiteValues.map(Math.abs)) <=
        0.1 * scale;
      const shouldSplit = depth < minimumDepth || (
        depth < maximumDepth && (
          !allInvalid && (invalid || curvature > 0.2 || valley || nearZero)
        )
      );
      if (shouldSplit) {
        this.#limit ??= this.#context.consume('interval-subdivisions');
        this.#limit ??= this.#context.consume('total-work');
        if (this.#limit) {
          return;
        }
        this.#subdivisions += 1;
        inspect(leftX, midpointX, depth + 1);
        inspect(midpointX, rightX, depth + 1);
        return;
      }
      if (left.value !== null && middle.value !== null && left.value * middle.value < 0) {
        brackets.push([left, middle]);
      }
      if (middle.value !== null && right.value !== null && middle.value * right.value < 0) {
        brackets.push([middle, right]);
      }
    };
    inspect(interval.lower, interval.upper, 0);
    if (this.#limit) {
      return this.#limit;
    }

    const candidates: Candidate[] = [];
    const endpointAllowed = (x: number) =>
      (x !== interval.lower || interval.includeLower) &&
      (x !== interval.upper || interval.includeUpper);
    for (const sample of cache.values()) {
      if (
        sample.value !== null &&
        endpointAllowed(sample.x) &&
        Math.abs(sample.value) <= tolerance
      ) {
        candidates.push({value: sample.x, method: 'sample'});
      }
    }
    for (const bracket of brackets) {
      this.#limit ??= this.#context.consume('brackets');
      if (this.#limit) {
        return this.#limit;
      }
      this.#brackets += 1;
      const candidate = this.#refineBracket(bracket[0], bracket[1], evaluate, tolerance);
      if (this.#limit) {
        return this.#limit;
      }
      if (candidate && endpointAllowed(candidate.value)) {
        candidates.push(candidate);
      }
    }

    const orderedSamples = [...cache.values()]
      .filter((sample): sample is Sample & {value: number} => sample.value !== null)
      .sort((left, right) => left.x - right.x);
    for (let index = 1; index + 1 < orderedSamples.length; index += 1) {
      const left = orderedSamples[index - 1]!;
      const middle = orderedSamples[index]!;
      const right = orderedSamples[index + 1]!;
      if (
        Math.abs(middle.value) <= 0.5 * Math.abs(left.value) &&
        Math.abs(middle.value) <= 0.5 * Math.abs(right.value)
      ) {
        const candidate = this.#refineMinimum(left.x, right.x, evaluate, tolerance);
        if (this.#limit) {
          return this.#limit;
        }
        if (candidate && endpointAllowed(candidate.value)) {
          candidates.push(candidate);
        }
      }
    }

    candidates.sort((left, right) => left.value - right.value);
    const unique: Candidate[] = [];
    for (const candidate of candidates) {
      const prior = unique[unique.length - 1];
      const duplicate = prior && Math.abs(candidate.value - prior.value) <=
        Math.max(1e-8, Math.sqrt(tolerance) / 10) *
          (1 + Math.abs(candidate.value));
      if (!duplicate) {
        unique.push(candidate);
      } else if (
        Math.abs(evaluate(candidate.value).value ?? Number.POSITIVE_INFINITY) <
        Math.abs(evaluate(prior.value).value ?? Number.POSITIVE_INFINITY)
      ) {
        unique[unique.length - 1] = candidate;
      }
    }
    const solutions: Solution[] = [];
    for (const candidate of unique) {
      this.#limit ??= this.#context.consume('candidates');
      if (this.#limit) {
        return this.#limit;
      }
      const value = new this.#dependencies.ConstantNode(
        Object.is(candidate.value, -0) ? 0 : candidate.value
      );
      const substitutedConditions = domainConditions.conditions.map((condition) =>
          this.#dependencies.symbolicKernel.condition(
            condition.kind,
            this.#dependencies.symbolicKernel.substitute(
              condition.expression,
              target,
              value
            )
          )
        );
      const normalized = this.#dependencies.symbolicKernel.normalizeConditions(
        substitutedConditions
      );
      const verification = this.#dependencies.symbolicKernel.verify(
        equation,
        target,
        value,
        normalized.conditions,
        tolerance
      );
      const scope = {[target]: candidate.value};
      if (
        normalized.contradictory ||
        !substitutedConditions.every((condition) =>
          numericSearchConditionSafelyHolds(condition, scope, tolerance)
        ) ||
        verification.status !== 'proven'
      ) {
        this.#rejected += 1;
        continue;
      }
      solutions.push(Object.freeze({
        value,
        conditions: normalized.conditions,
        exact: false,
        verification: Object.freeze({
          status: 'proven',
          evidence: Object.freeze({
            method: candidate.method,
            ...(candidate.bracket ? {bracket: candidate.bracket} : {})
          })
        })
      }));
    }
    const diagnostics = this.#diagnostics(Boolean(options.diagnostics));
    const result: PartialResult = Object.freeze({
      kind: 'partial',
      target,
      solutions: Object.freeze(solutions),
      remainder: equation,
      reason: 'numeric-search-incomplete',
      scope: createSearchScope('real', 'partial', interval),
      ...(diagnostics ? {diagnostics} : {})
    });
    return result;
  }
}

export const createNumericSolve = customFactory(
  'numericSolve',
  ['ConstantNode', 'OperatorNode', 'symbolicKernel'],
  (rawDependencies) => {
    const engine = new NumericSolveEngine(
      rawDependencies as unknown as NumericSolveDependencies
    );
    return (
      equation: EqualityNode,
      target: string,
      options?: SolveOptions
    ) => engine.solve(equation, target, options);
  }
);
