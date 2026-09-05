import type {MathNode} from 'mathjs';
import type {
  OperationContextOptions,
  OperationLimitExceeded
} from '../operation-context.js';
import type {SymbolicPredicate} from '../predicate.js';

export type CanonicalizationProfile =
  | 'structural'
  | 'scalar'
  | 'real-algebraic'
  | 'complex-safe'
  | 'presentation'
  | 'polynomial'
  | 'rational';

export type CanonicalizationRule =
  | 'remove-parentheses'
  | 'remove-unary-plus'
  | 'normalize-negative-zero'
  | 'fold-unary-minus'
  | 'cancel-double-negation'
  | 'normalize-subtraction'
  | 'flatten-addition'
  | 'flatten-multiplication'
  | 'sort-addition'
  | 'sort-multiplication'
  | 'fold-additive-constants'
  | 'fold-multiplicative-constants'
  | 'remove-additive-zero'
  | 'remove-multiplicative-one'
  | 'apply-zero-annihilator'
  | 'fold-constant-operator'
  | 'fold-constant-function'
  | 'simplify-power-one'
  | 'simplify-power-zero'
  | 'simplify-one-power'
  | 'simplify-zero-power'
  | 'normalize-real-square-root'
  | 'rebuild-equality'
  | 'rebuild-function'
  | 'rebuild-operator'
  | 'rebuild-node'
  | 'rebuild-polynomial'
  | 'rebuild-rational';

export interface CanonicalizationOptions extends OperationContextOptions {
  readonly profile?: CanonicalizationProfile;
  readonly generators?: readonly (string | MathNode)[];
  readonly maximumPasses?: number;
  readonly maximumNodes?: number;
  readonly maximumSteps?: number;
}

export interface CanonicalizationTraceStep {
  readonly rule: CanonicalizationRule;
  readonly before: string;
  readonly after: string;
  readonly requirements: readonly SymbolicPredicate[];
}

export interface CanonicalizationResult {
  readonly expression: MathNode;
  readonly profile: CanonicalizationProfile;
  readonly changed: boolean;
  readonly complete: boolean;
  readonly requirements: readonly SymbolicPredicate[];
  readonly trace: readonly CanonicalizationTraceStep[];
  readonly limit?: OperationLimitExceeded;
}

export interface NormalizedCanonicalizationOptions {
  readonly profile: CanonicalizationProfile;
  readonly maximumPasses: number;
  readonly maximumNodes: number;
  readonly maximumSteps: number;
}
