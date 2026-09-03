import type {MathNode} from 'mathjs';

export type ConditionKind =
  | 'zero'
  | 'nonzero'
  | 'positive'
  | 'nonnegative'
  | 'negative'
  | 'nonpositive'
  | 'defined';

export interface Condition {
  readonly kind: ConditionKind;
  readonly expression: MathNode;
}

export type VerificationStatus = 'proven' | 'rejected' | 'inconclusive';

export interface VerificationResult {
  readonly status: VerificationStatus;
  readonly reason?: string;
}

export interface Solution {
  readonly value: MathNode;
  readonly conditions: readonly Condition[];
  readonly exact: boolean;
  readonly verification: VerificationResult;
}

export interface FiniteSolutions {
  readonly kind: 'finite';
  readonly target: string;
  readonly solutions: readonly Solution[];
}

export interface IdentityResult {
  readonly kind: 'identity';
  readonly target: string;
  readonly conditions: readonly Condition[];
}

export interface ContradictionResult {
  readonly kind: 'contradiction';
  readonly target: string;
  readonly conditions: readonly Condition[];
}

export type UnsupportedReason =
  | 'invalid-target'
  | 'no-rule'
  | 'unsupported-structure'
  | 'unsupported-function'
  | 'symbolic-cubic'
  | 'verification-inconclusive';

export interface PartialResult {
  readonly kind: 'partial';
  readonly target: string;
  readonly solutions: readonly Solution[];
  readonly remainder: import('./types.js').EqualityNode;
  readonly reason: UnsupportedReason;
}

export interface UnsupportedResult {
  readonly kind: 'unsupported';
  readonly target: string;
  readonly reason: UnsupportedReason;
}

export type LimitKind =
  | 'input-nodes'
  | 'rewrite-steps'
  | 'recursion-depth'
  | 'branches'
  | 'candidates'
  | 'numeric-iterations'
  | 'total-work';

export interface LimitResult {
  readonly kind: 'limit';
  readonly target: string;
  readonly limit: LimitKind;
}

export type SolveResult =
  | FiniteSolutions
  | IdentityResult
  | ContradictionResult
  | PartialResult
  | UnsupportedResult
  | LimitResult;

export interface SolverLimits {
  readonly inputNodes: number;
  readonly rewriteSteps: number;
  readonly recursionDepth: number;
  readonly branches: number;
  readonly candidates: number;
  readonly numericIterations: number;
  readonly totalWork: number;
}

export interface SolveOptions {
  readonly limits?: Partial<SolverLimits>;
  readonly tolerance?: number;
}

export const DEFAULT_SOLVER_LIMITS: SolverLimits = Object.freeze({
  inputNodes: 1000,
  rewriteSteps: 500,
  recursionDepth: 100,
  branches: 32,
  candidates: 64,
  numericIterations: 200,
  totalWork: 5000
});

export const DEFAULT_SOLVE_TOLERANCE = 1e-12;

export function unsupportedResult(
  target: string,
  reason: UnsupportedReason
): UnsupportedResult {
  return Object.freeze({kind: 'unsupported', target, reason});
}

export function limitResult(target: string, limit: LimitKind): LimitResult {
  return Object.freeze({kind: 'limit', target, limit});
}
