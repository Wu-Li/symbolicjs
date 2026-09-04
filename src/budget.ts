import type {MathNode} from 'mathjs';
import {OperationBudget} from './core/operation-context.js';
import {
  DEFAULT_SOLVER_LIMITS,
  limitResult,
  validateSolveOptions
} from './solve-types.js';
import type {
  LimitKind,
  LimitResult,
  SolveOptions,
  SolverLimits
} from './solve-types.js';

type ConsumableLimit = Exclude<
  LimitKind,
  'input-nodes' | 'polynomial-degree' | 'numeric-polynomial-degree'
>;

const LIMIT_PROPERTY: Readonly<Record<LimitKind, keyof SolverLimits>> = {
  'input-nodes': 'inputNodes',
  'polynomial-degree': 'polynomialDegree',
  'numeric-polynomial-degree': 'numericPolynomialDegree',
  'rewrite-steps': 'rewriteSteps',
  'recursion-depth': 'recursionDepth',
  branches: 'branches',
  candidates: 'candidates',
  'numeric-iterations': 'numericIterations',
  'function-evaluations': 'functionEvaluations',
  'interval-subdivisions': 'intervalSubdivisions',
  brackets: 'brackets',
  'parametric-families': 'parametricFamilies',
  'symbolic-expression-nodes': 'symbolicExpressionNodes',
  'total-work': 'totalWork'
};

function validateLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Solver limit "' + name + '" must be a nonnegative safe integer');
  }
  return value;
}

export function resolveLimits(options?: SolveOptions): SolverLimits {
  validateSolveOptions(options);
  const supplied = options?.limits ?? {};
  const limits = {...DEFAULT_SOLVER_LIMITS, ...supplied};

  for (const [name, value] of Object.entries(limits)) {
    validateLimit(name, value);
  }

  return Object.freeze(limits);
}

function operationLimits(limits: SolverLimits): Readonly<Record<string, number>> {
  return Object.freeze(Object.fromEntries(
    Object.entries(LIMIT_PROPERTY).map(([kind, property]) => [kind, limits[property]])
  ));
}

/** Compatibility adapter from operation-neutral budgets to public solver limits. */
export class SolverContext {
  readonly target: string;
  readonly limits: SolverLimits;
  readonly used: Record<ConsumableLimit, number> = {
    'rewrite-steps': 0,
    'recursion-depth': 0,
    branches: 0,
    candidates: 0,
    'numeric-iterations': 0,
    'function-evaluations': 0,
    'interval-subdivisions': 0,
    brackets: 0,
    'parametric-families': 0,
    'symbolic-expression-nodes': 0,
    'total-work': 0
  };

  readonly #budget: OperationBudget;

  constructor(target: string, options?: SolveOptions) {
    this.target = target;
    this.limits = resolveLimits(options);
    this.#budget = new OperationBudget(operationLimits(this.limits));
  }

  preflight(node: MathNode): LimitResult | null {
    let count = 0;
    node.traverse(() => {
      count += 1;
    });
    return this.#legacyLimit(this.#budget.check('input-nodes', count));
  }

  checkPolynomialDegree(degree: number): LimitResult | null {
    return this.#legacyLimit(this.#budget.check('polynomial-degree', degree));
  }

  checkNumericPolynomialDegree(degree: number): LimitResult | null {
    return this.#legacyLimit(this.#budget.check('numeric-polynomial-degree', degree));
  }

  consume(kind: ConsumableLimit, amount = 1): LimitResult | null {
    const exceeded = this.#budget.consume(kind, amount);
    this.used[kind] = this.#budget.usage(kind);
    return this.#legacyLimit(exceeded);
  }

  #legacyLimit(
    exceeded: {readonly limit: string} | null
  ): LimitResult | null {
    return exceeded
      ? limitResult(this.target, exceeded.limit as LimitKind)
      : null;
  }
}
