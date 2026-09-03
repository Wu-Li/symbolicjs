import {customFactory} from './custom-factory.js';
import {SolverContext} from './budget.js';
import {unsupportedResult} from './solve-types.js';
import type {SolveOptions, SolveResult} from './solve-types.js';
import type {EqualityNode} from './types.js';

interface SolveDependencies {
  equationSymbols(equation: EqualityNode): readonly string[];
  parseEquation(source: string): EqualityNode;
  isolateEquation(
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
  if (!symbols.includes(target)) {
    return unsupportedResult(target, 'invalid-target');
  }

  const context = new SolverContext(target, options);
  const limit = context.preflight(equation);
  return limit ?? dependencies.isolateEquation(equation, target, options);
}

export const createSolveEquation = customFactory(
  'solveEquation',
  ['equationSymbols', 'parseEquation', 'isolateEquation'],
  (rawDependencies) => {
    const dependencies = rawDependencies as unknown as SolveDependencies;
    return (
      equation: EqualityNode | string,
      target: string,
      options?: SolveOptions
    ) => solveEquation(dependencies, equation, target, options);
  }
);
