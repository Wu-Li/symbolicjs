import type {MathNode} from 'mathjs';
import type {
  OperationContextOptions,
  OperationLimitExceeded
} from '../core/operation-context.js';
import type {SymbolicPredicate} from '../core/predicate.js';

export type AlgebraNotRepresentableReason =
  | 'unsupported-node'
  | 'duplicate-generator'
  | 'dependent-coefficient'
  | 'nonlinear-product'
  | 'generator-denominator'
  | 'negative-exponent'
  | 'nonintegral-exponent'
  | 'nonconstant-exponent'
  | 'zero-denominator'
  | 'nonzero-unproven'
  | 'scalar-unproven'
  | 'not-polynomial'
  | 'not-rational';

export interface AlgebraNotRepresentable {
  readonly kind: 'not-representable';
  readonly reason: AlgebraNotRepresentableReason;
  readonly expression: MathNode;
  readonly detail?: string;
}

export interface AlgebraViewSuccess<T> {
  readonly kind: 'view';
  readonly view: T;
}

export type AlgebraViewResult<T> =
  | AlgebraViewSuccess<T>
  | AlgebraNotRepresentable
  | OperationLimitExceeded;

export interface AlgebraLimits {
  readonly maximumNodes: number;
  readonly maximumDepth: number;
  readonly maximumDegree: number;
  readonly maximumMonomials: number;
  readonly maximumConvolutions: number;
  readonly maximumRebuildNodes: number;
}

export interface AlgebraOptions extends OperationContextOptions {
  readonly algebraLimits?: Partial<AlgebraLimits>;
}

export type AlgebraGenerator = string | MathNode;

export interface ExpressionSelection {
  readonly symbols?: readonly string[];
  readonly atoms?: readonly MathNode[];
}

export interface ExpressionAnalysisOptions
  extends AlgebraOptions,
    ExpressionSelection {
  readonly includeLeafDefinedness?: boolean;
}

export type SafeEvaluationResult =
  | {
    readonly kind: 'value';
    readonly value: unknown;
  }
  | {
    readonly kind: 'unevaluated';
    readonly reason: 'free-symbols' | 'evaluation-error';
    readonly freeSymbols: readonly string[];
  };

export interface ExpressionInventoryEntry {
  readonly name: string;
  readonly count: number;
}

export interface AtomOccurrence {
  readonly atom: MathNode;
  readonly count: number;
}

export interface ExpressionAnalysis {
  readonly kind: 'analysis';
  readonly expression: MathNode;
  readonly freeSymbols: readonly string[];
  readonly symbolOccurrences: Readonly<Record<string, number>>;
  readonly atomOccurrences: readonly AtomOccurrence[];
  readonly dependsOnSelection: boolean;
  readonly targetFree: boolean;
  readonly constant: boolean;
  readonly operators: readonly ExpressionInventoryEntry[];
  readonly functions: readonly ExpressionInventoryEntry[];
  readonly definedness: readonly SymbolicPredicate[];
  readonly evaluation: SafeEvaluationResult;
  readonly nodeCount: number;
  readonly maximumDepth: number;
}

export type ExpressionAnalysisResult = ExpressionAnalysis | OperationLimitExceeded;

export interface AlgebraView {
  readonly source: MathNode;
  readonly requirements: readonly SymbolicPredicate[];
  rebuild(): MathNode;
}

export interface SumView extends AlgebraView {
  readonly kind: 'sum';
  readonly terms: readonly MathNode[];
}

export interface ProductView extends AlgebraView {
  readonly kind: 'product';
  readonly factors: readonly MathNode[];
}

export interface PowerView extends AlgebraView {
  readonly kind: 'power';
  readonly base: MathNode;
  readonly exponent: MathNode;
}

export interface AffineView extends AlgebraView {
  readonly kind: 'affine';
  readonly generator: MathNode;
  readonly coefficient: MathNode;
  readonly constant: MathNode;
}

export interface LinearForm extends AlgebraView {
  readonly kind: 'linear-form';
  readonly basis: readonly MathNode[];
  readonly coefficients: readonly MathNode[];
  readonly constant: MathNode;
  coefficientOf(generator: number | AlgebraGenerator): MathNode | null;
}

export interface SparsePolynomialTerm {
  readonly exponents: readonly number[];
  readonly coefficient: MathNode;
}

export interface SparsePolynomialView extends AlgebraView {
  readonly kind: 'sparse-polynomial';
  readonly generators: readonly MathNode[];
  readonly terms: readonly SparsePolynomialTerm[];
  readonly totalDegree: number;
  degree(generator?: number | AlgebraGenerator): number;
  coefficient(exponents: readonly number[]): MathNode | null;
}

export interface RationalFunctionView extends AlgebraView {
  readonly kind: 'rational-function';
  readonly generators: readonly MathNode[];
  readonly numerator: SparsePolynomialView;
  readonly denominator: SparsePolynomialView;
}

export interface LinearFormOptions extends AlgebraOptions {
  readonly basis: readonly AlgebraGenerator[];
}

export interface AffineViewOptions extends AlgebraOptions {
  readonly generator: AlgebraGenerator;
}

export interface PolynomialViewOptions extends AlgebraOptions {
  readonly generators: readonly AlgebraGenerator[];
}
