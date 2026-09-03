import {customFactory} from './custom-factory.js';
import {SolverContext} from './budget.js';
import {unsupportedResult, validateSolveOptions} from './solve-types.js';
import type {
  ParametricFamily,
  PartialResult,
  Solution,
  SolveDiagnostics,
  SolveOptions,
  SolveResult,
  SolveTraceStep
} from './solve-types.js';
import type {EqualityNode} from './types.js';

interface SolveDependencies {
  equationSymbols(equation: EqualityNode): readonly string[];
  parseEquation(source: string): EqualityNode;
  isolateEquation(
    equation: EqualityNode,
    target: string,
    options?: SolveOptions
  ): SolveResult;
  polynomialSolve(
    equation: EqualityNode,
    target: string,
    options?: SolveOptions,
    maximumDegree?: number
  ): SolveResult;
  trigonometricSolve(
    equation: EqualityNode,
    target: string,
    options?: SolveOptions
  ): SolveResult;
  compoundTrigonometricSolve(
    equation: EqualityNode,
    target: string,
    options?: SolveOptions
  ): SolveResult;
  numericSolve(
    equation: EqualityNode,
    target: string,
    options?: SolveOptions
  ): SolveResult;
}

function conditionKey(
  conditions: readonly import('./solve-types.js').Condition[]
): string {
  return [...conditions].map((condition) =>
    condition.kind + ':' + condition.expression.toString({parenthesis: 'all'})
  ).sort().join('|');
}

function uniqueSolutions(results: readonly PartialResult[]): readonly Solution[] {
  const values = new Map<string, Solution>();
  for (const result of results) {
    for (const solution of result.solutions) {
      const key = solution.value.toString({parenthesis: 'all'}) + '|' +
        conditionKey(solution.conditions);
      if (!values.has(key)) {
        values.set(key, solution);
      }
    }
  }
  return Object.freeze([...values.values()]);
}

function uniqueFamilies(results: readonly PartialResult[]): readonly ParametricFamily[] {
  const values = new Map<string, ParametricFamily>();
  for (const result of results) {
    for (const family of result.families ?? []) {
      const key = family.value.toString({parenthesis: 'all'}) + '|' +
        family.parameters.map((parameter) => parameter.name).join(',') + '|' +
        conditionKey(family.conditions);
      if (!values.has(key)) {
        values.set(key, family);
      }
    }
  }
  return Object.freeze([...values.values()]);
}

export function mergePartialSolveResults(
  equation: EqualityNode,
  target: string,
  results: readonly PartialResult[]
): PartialResult {
  if (results.length === 0) {
    throw new RangeError('At least one partial result is required');
  }
  if (results.length === 1) {
    return results[0]!;
  }
  const families = uniqueFamilies(results);
  const scope = results.find((result) => result.scope)?.scope;
  return Object.freeze({
    kind: 'partial',
    target,
    solutions: uniqueSolutions(results),
    ...(families.length === 0 ? {} : {families}),
    remainder: equation,
    reason: results.some((result) => result.reason === 'numeric-search-incomplete')
      ? 'numeric-search-incomplete'
      : results[0]!.reason,
    ...(scope === undefined ? {} : {scope})
  });
}

export function solveEquation(
  dependencies: SolveDependencies,
  equationInput: EqualityNode | string,
  target: string,
  options?: SolveOptions
): SolveResult {
  validateSolveOptions(options);
  const steps: SolveTraceStep[] | null = options?.diagnostics ? [] : null;
  const trace = (step: SolveTraceStep): void => {
    steps?.push(Object.freeze(step));
  };
  const finish = (result: SolveResult): SolveResult => {
    if (!steps) {
      return result;
    }
    if (result.diagnostics) {
      steps.push(...result.diagnostics.steps);
    }
    const verified = result.kind === 'finite' || result.kind === 'partial'
      ? result.solutions
      : result.kind === 'parametric'
        ? result.families
        : [];
    for (const solution of verified) {
      trace({
        stage: 'verification',
        rule: 'candidate-verification',
        expression: target + ' = ' + solution.value.toString(),
        conditions: Object.freeze(solution.conditions.map((condition) =>
          condition.kind + ':' + condition.expression.toString()
        )),
        outcome: solution.verification.status
      });
    }
    trace({stage: 'result', rule: 'classification', outcome: result.kind});
    const diagnostics: SolveDiagnostics = Object.freeze({
      steps: Object.freeze([...steps])
    });
    return Object.freeze({...result, diagnostics}) as SolveResult;
  };
  if (typeof target !== 'string' || target.trim() !== target || target === '') {
    throw new TypeError('Target must be a nonempty, trimmed symbol name');
  }
  const equation = typeof equationInput === 'string'
    ? dependencies.parseEquation(equationInput)
    : equationInput;
  if (!equation?.isEqualityNode) {
    throw new TypeError('EqualityNode or equation string expected');
  }

  const symbols = dependencies.equationSymbols(equation);
  trace({
    stage: 'analysis',
    rule: 'free-symbols',
    expression: equation.toString(),
    outcome: symbols.join(',')
  });
  if (!symbols.includes(target)) {
    return finish(unsupportedResult(target, 'invalid-target'));
  }

  const context = new SolverContext(target, options);
  const limit = context.preflight(equation);
  if (limit) {
    return finish(limit);
  }
  if (options?.domain === 'complex') {
    const polynomial = dependencies.polynomialSolve(equation, target, options);
    trace({
      stage: 'dispatch',
      rule: 'complex-polynomial',
      outcome: polynomial.kind
    });
    return finish(
      polynomial.kind === 'unsupported' && polynomial.reason === 'no-rule'
        ? unsupportedResult(target, 'unsupported-domain')
        : polynomial
    );
  }
  const partials: PartialResult[] = [];
  const preservePartial = (result: SolveResult): SolveResult | null => {
    if (result.kind === 'partial') {
      partials.push(result);
      return null;
    }
    if (result.kind === 'contradiction' && partials.length > 0) {
      return null;
    }
    return result;
  };
  const isolated = dependencies.isolateEquation(equation, target, options);
  trace({
    stage: 'dispatch',
    rule: 'single-occurrence-isolation',
    outcome: isolated.kind
  });
  if (isolated.kind === 'unsupported' && (
    isolated.reason === 'no-rule' ||
    isolated.reason === 'unsupported-function' ||
    options?.numericFallback
  )) {
    const trigonometric = dependencies.trigonometricSolve(equation, target, options);
    trace({
      stage: 'dispatch',
      rule: 'trigonometric',
      outcome: trigonometric.kind
    });
    if (trigonometric.kind !== 'unsupported' || (
      trigonometric.reason !== 'no-rule' &&
      trigonometric.reason !== 'unsupported-trig-form'
    )) {
      const terminal = preservePartial(trigonometric);
      if (terminal) {
        return finish(terminal);
      }
    }
    const compound = dependencies.compoundTrigonometricSolve(equation, target, options);
    trace({
      stage: 'dispatch',
      rule: 'compound-trigonometric',
      outcome: compound.kind
    });
    if (compound.kind !== 'unsupported' || (
      compound.reason !== 'no-rule' && compound.reason !== 'unsupported-trig-form'
    )) {
      const terminal = preservePartial(compound);
      if (terminal) {
        return finish(terminal);
      }
    }
    const polynomial = dependencies.polynomialSolve(equation, target, options);
    trace({
      stage: 'dispatch',
      rule: polynomial.kind === 'finite' && polynomial.solutions.some(
        (solution) => !solution.exact
      )
        ? polynomial.solutions.some((solution) =>
          solution.verification.evidence?.method === 'residual'
        )
          ? 'numeric-polynomial'
          : polynomial.solutions.some((solution) => solution.certificate?.kind === 'quartic')
            ? 'numeric-quartic'
            : 'numeric-cubic'
        : 'rational-polynomial',
      outcome: polynomial.kind
    });
    if (polynomial.kind === 'partial') {
      partials.push(polynomial);
      trace({
        stage: 'dispatch',
        rule: 'merge-partial-results',
        outcome: String(partials.length)
      });
      return finish(mergePartialSolveResults(equation, target, partials));
    }
    if (polynomial.kind === 'unsupported' && partials.length > 0) {
      trace({
        stage: 'dispatch',
        rule: 'merge-partial-results',
        outcome: String(partials.length)
      });
      return finish(mergePartialSolveResults(equation, target, partials));
    }
    if (polynomial.kind === 'unsupported' && options?.numericFallback) {
      const numeric = dependencies.numericSolve(equation, target, options);
      trace({stage: 'dispatch', rule: 'bounded-numeric-search', outcome: numeric.kind});
      return finish(numeric);
    }
    const terminal = preservePartial(polynomial);
    if (terminal === null) {
      trace({
        stage: 'dispatch',
        rule: 'merge-partial-results',
        outcome: String(partials.length)
      });
      return finish(mergePartialSolveResults(equation, target, partials));
    }
    return finish(
      terminal.kind === 'unsupported' && terminal.reason === 'no-rule' &&
      ((compound.kind === 'unsupported' &&
        compound.reason === 'unsupported-trig-form') ||
        (trigonometric.kind === 'unsupported' &&
          trigonometric.reason === 'unsupported-trig-form'))
        ? unsupportedResult(target, 'unsupported-trig-form')
        : terminal
    );
  }
  return finish(isolated);
}

export const createSolveEquation = customFactory(
  'solveEquation',
  [
    'equationSymbols',
    'parseEquation',
    'isolateEquation',
    'trigonometricSolve',
    'compoundTrigonometricSolve',
    'polynomialSolve',
    'numericSolve'
  ],
  (rawDependencies) => {
    const dependencies = rawDependencies as unknown as SolveDependencies;
    return (
      equation: EqualityNode | string,
      target: string,
      options?: SolveOptions
    ) => solveEquation(dependencies, equation, target, options);
  }
);
