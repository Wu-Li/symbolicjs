import type {MathNode} from 'mathjs';
import {
  DEFAULT_SOLVER_LIMITS,
  limitResult
} from './solve-types.js';
import type {
  LimitKind,
  LimitResult,
  SolveOptions,
  SolverLimits
} from './solve-types.js';

type ConsumableLimit = Exclude<LimitKind, 'input-nodes'>;

const LIMIT_PROPERTY: Readonly<Record<ConsumableLimit, keyof SolverLimits>> = {
  'rewrite-steps': 'rewriteSteps',
  'recursion-depth': 'recursionDepth',
  branches: 'branches',
  candidates: 'candidates',
  'numeric-iterations': 'numericIterations',
  'total-work': 'totalWork'
};

function validateLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Solver limit "' + name + '" must be a nonnegative safe integer');
  }
  return value;
}

export function resolveLimits(options?: SolveOptions): SolverLimits {
  const supplied = options?.limits ?? {};
  const limits = {...DEFAULT_SOLVER_LIMITS, ...supplied};

  for (const [name, value] of Object.entries(limits)) {
    validateLimit(name, value);
  }

  return Object.freeze(limits);
}

export class SolverContext {
  readonly target: string;
  readonly limits: SolverLimits;
  readonly used: Record<ConsumableLimit, number> = {
    'rewrite-steps': 0,
    'recursion-depth': 0,
    branches: 0,
    candidates: 0,
    'numeric-iterations': 0,
    'total-work': 0
  };

  constructor(target: string, options?: SolveOptions) {
    this.target = target;
    this.limits = resolveLimits(options);
  }

  preflight(node: MathNode): LimitResult | null {
    let count = 0;
    node.traverse(() => {
      count += 1;
    });
    return count > this.limits.inputNodes
      ? limitResult(this.target, 'input-nodes')
      : null;
  }

  consume(kind: ConsumableLimit, amount = 1): LimitResult | null {
    validateLimit('amount', amount);
    this.used[kind] += amount;
    const property = LIMIT_PROPERTY[kind];
    return this.used[kind] > this.limits[property]
      ? limitResult(this.target, kind)
      : null;
  }
}
