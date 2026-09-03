import {customFactory} from './custom-factory.js';
import {SolverContext} from './budget.js';
import {unsupportedResult, validateSolveOptions} from './solve-types.js';
import type {
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
  const isolated = dependencies.isolateEquation(equation, target, options);
  trace({
    stage: 'dispatch',
    rule: 'single-occurrence-isolation',
    outcome: isolated.kind
  });
  if (isolated.kind === 'unsupported' && (
    isolated.reason === 'no-rule' || isolated.reason === 'unsupported-function'
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
      return finish(trigonometric);
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
      return finish(compound);
    }
    const polynomial = dependencies.polynomialSolve(equation, target, options);
    trace({
      stage: 'dispatch',
      rule: polynomial.kind === 'finite' && polynomial.solutions.some(
        (solution) => !solution.exact
      ) ? 'numeric-cubic' : 'rational-polynomial',
      outcome: polynomial.kind
    });
    return finish(
      polynomial.kind === 'unsupported' && polynomial.reason === 'no-rule' &&
      (compound.reason === 'unsupported-trig-form' ||
        trigonometric.reason === 'unsupported-trig-form')
        ? unsupportedResult(target, 'unsupported-trig-form')
        : polynomial
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
    'polynomialSolve'
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
