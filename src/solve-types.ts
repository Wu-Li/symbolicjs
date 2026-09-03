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
  readonly evidence?: VerificationEvidence;
}

export type VerificationMethod =
  | 'symbolic'
  | 'construction'
  | 'bracket'
  | 'residual'
  | 'sample';

export interface VerificationEvidence {
  readonly method: VerificationMethod;
  readonly residual?: number;
  readonly bracket?: readonly [number, number];
}

export type CubicConstructionBranch =
  | 'one-real'
  | 'triple-root'
  | 'simple-and-double'
  | 'three-real';

export interface CubicConstructionCertificate {
  readonly kind: 'cubic';
  readonly branch: CubicConstructionBranch;
  readonly coefficients: readonly [MathNode, MathNode, MathNode, MathNode];
  readonly depressedLinearCoefficient: MathNode;
  readonly depressedConstant: MathNode;
  readonly discriminant: MathNode;
}

export type QuarticConstructionBranch = 'biquadratic' | 'ferrari';

export interface QuarticConstructionCertificate {
  readonly kind: 'quartic';
  readonly branch: QuarticConstructionBranch;
  readonly coefficients: readonly [
    MathNode,
    MathNode,
    MathNode,
    MathNode,
    MathNode
  ];
  readonly depressedQuadraticCoefficient: MathNode;
  readonly depressedLinearCoefficient: MathNode;
  readonly depressedConstant: MathNode;
  readonly resolventRoot?: MathNode;
}

export type PolynomialConstructionCertificate =
  | CubicConstructionCertificate
  | QuarticConstructionCertificate;

export type ScalarDomain = 'real' | 'complex';

export interface RealInterval {
  readonly lower: number;
  readonly upper: number;
  readonly includeLower?: boolean;
  readonly includeUpper?: boolean;
}

export type SearchCompleteness =
  | 'complete'
  | 'complete-in-interval'
  | 'partial';

export interface SearchScope {
  readonly domain: ScalarDomain;
  readonly interval?: RealInterval;
  readonly completeness: SearchCompleteness;
}

export type SolveTraceStage =
  | 'analysis'
  | 'dispatch'
  | 'verification'
  | 'result';

export interface SolveTraceStep {
  readonly stage: SolveTraceStage;
  readonly rule: string;
  readonly expression?: string;
  readonly conditions?: readonly string[];
  readonly outcome?: string;
}

export interface SolveDiagnostics {
  readonly steps: readonly SolveTraceStep[];
}

interface DiagnosableResult {
  readonly diagnostics?: SolveDiagnostics;
  readonly scope?: SearchScope;
}

export interface Solution {
  readonly value: MathNode;
  readonly conditions: readonly Condition[];
  readonly exact: boolean;
  readonly verification: VerificationResult;
  readonly multiplicity?: number;
  readonly certificate?: PolynomialConstructionCertificate;
}

export interface IntegerParameter {
  readonly name: string;
  readonly domain: 'integer';
}

export interface PeriodicFamilyCertificate {
  readonly kind: 'periodic';
  readonly functionName: string;
  readonly inverseFunction: string;
  readonly period: MathNode;
  readonly inner: MathNode;
  readonly branch: string;
}

export interface ParametricFamily {
  readonly value: MathNode;
  readonly parameters: readonly IntegerParameter[];
  readonly conditions: readonly Condition[];
  readonly exact: true;
  readonly verification: VerificationResult;
  readonly certificate?: PeriodicFamilyCertificate;
}

export interface ParametricSolutions extends DiagnosableResult {
  readonly kind: 'parametric';
  readonly target: string;
  readonly domain: 'real';
  readonly families: readonly ParametricFamily[];
  readonly completeness: 'complete';
}

export interface FiniteSolutions extends DiagnosableResult {
  readonly kind: 'finite';
  readonly target: string;
  readonly solutions: readonly Solution[];
}

export interface IdentityResult extends DiagnosableResult {
  readonly kind: 'identity';
  readonly target: string;
  readonly conditions: readonly Condition[];
}

export interface ContradictionResult extends DiagnosableResult {
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
  | 'verification-inconclusive'
  | 'interval-required'
  | 'unsupported-domain'
  | 'unsupported-trig-form'
  | 'numeric-search-incomplete'
  | 'symbolic-expression-limit';

export interface PartialResult extends DiagnosableResult {
  readonly kind: 'partial';
  readonly target: string;
  readonly solutions: readonly Solution[];
  readonly families?: readonly ParametricFamily[];
  readonly remainder: import('./types.js').EqualityNode;
  readonly reason: UnsupportedReason;
}

export interface UnsupportedResult extends DiagnosableResult {
  readonly kind: 'unsupported';
  readonly target: string;
  readonly reason: UnsupportedReason;
}

export type LimitKind =
  | 'input-nodes'
  | 'polynomial-degree'
  | 'numeric-polynomial-degree'
  | 'rewrite-steps'
  | 'recursion-depth'
  | 'branches'
  | 'candidates'
  | 'numeric-iterations'
  | 'function-evaluations'
  | 'interval-subdivisions'
  | 'brackets'
  | 'parametric-families'
  | 'symbolic-expression-nodes'
  | 'total-work';

export interface LimitResult extends DiagnosableResult {
  readonly kind: 'limit';
  readonly target: string;
  readonly limit: LimitKind;
}

export type SolveResult =
  | FiniteSolutions
  | ParametricSolutions
  | IdentityResult
  | ContradictionResult
  | PartialResult
  | UnsupportedResult
  | LimitResult;

export interface SolverLimits {
  readonly inputNodes: number;
  readonly polynomialDegree: number;
  readonly numericPolynomialDegree: number;
  readonly rewriteSteps: number;
  readonly recursionDepth: number;
  readonly branches: number;
  readonly candidates: number;
  readonly numericIterations: number;
  readonly functionEvaluations: number;
  readonly intervalSubdivisions: number;
  readonly brackets: number;
  readonly parametricFamilies: number;
  readonly symbolicExpressionNodes: number;
  readonly totalWork: number;
}

export interface SolveOptions {
  readonly domain?: ScalarDomain;
  readonly interval?: RealInterval;
  readonly numericFallback?: boolean;
  readonly limits?: Partial<SolverLimits>;
  readonly tolerance?: number;
  readonly diagnostics?: boolean;
}

export const DEFAULT_SOLVER_LIMITS: SolverLimits = Object.freeze({
  inputNodes: 1000,
  polynomialDegree: 4,
  numericPolynomialDegree: 32,
  rewriteSteps: 500,
  recursionDepth: 100,
  branches: 64,
  candidates: 64,
  numericIterations: 1000,
  functionEvaluations: 5000,
  intervalSubdivisions: 2048,
  brackets: 256,
  parametricFamilies: 64,
  symbolicExpressionNodes: 100000,
  totalWork: 100000
});

export const DEFAULT_SOLVE_TOLERANCE = 1e-12;

function optionalBoolean(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new TypeError(`Solve option "${name}" must be boolean`);
  }
}

export function normalizeRealInterval(interval: RealInterval): RealInterval {
  if (!interval || typeof interval !== 'object' || Array.isArray(interval)) {
    throw new TypeError('Solve interval must be an object');
  }
  const {lower, upper, includeLower = true, includeUpper = true} = interval;
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
    throw new RangeError('Solve interval bounds must be finite');
  }
  if (lower > upper) {
    throw new RangeError('Solve interval lower bound must not exceed upper bound');
  }
  if (typeof includeLower !== 'boolean' || typeof includeUpper !== 'boolean') {
    throw new TypeError('Solve interval endpoint flags must be boolean');
  }
  if (lower === upper && (!includeLower || !includeUpper)) {
    throw new RangeError('Solve interval must not be empty');
  }
  return Object.freeze({
    lower: Object.is(lower, -0) ? 0 : lower,
    upper: Object.is(upper, -0) ? 0 : upper,
    includeLower,
    includeUpper
  });
}

export function validateSolveOptions(options?: SolveOptions): void {
  if (options === undefined) {
    return;
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Solve options must be an object');
  }
  const domain = options.domain ?? 'real';
  if (domain !== 'real' && domain !== 'complex') {
    throw new TypeError('Solve option "domain" must be "real" or "complex"');
  }
  optionalBoolean(options.numericFallback, 'numericFallback');
  optionalBoolean(options.diagnostics, 'diagnostics');
  if (
    options.limits !== undefined &&
    (!options.limits || typeof options.limits !== 'object' || Array.isArray(options.limits))
  ) {
    throw new TypeError('Solve option "limits" must be an object');
  }
  if (
    options.tolerance !== undefined &&
    (!Number.isFinite(options.tolerance) || options.tolerance <= 0)
  ) {
    throw new RangeError('Solve tolerance must be positive and finite');
  }
  if (options.interval !== undefined) {
    if (domain !== 'real') {
      throw new RangeError('Solve intervals are available only in the real domain');
    }
    normalizeRealInterval(options.interval);
  }
}

export function createSearchScope(
  domain: ScalarDomain,
  completeness: SearchCompleteness,
  interval?: RealInterval
): SearchScope {
  if (domain !== 'real' && domain !== 'complex') {
    throw new TypeError('Search scope domain must be "real" or "complex"');
  }
  if (
    completeness !== 'complete' &&
    completeness !== 'complete-in-interval' &&
    completeness !== 'partial'
  ) {
    throw new TypeError('Search scope completeness is unknown');
  }
  if (interval !== undefined && domain !== 'real') {
    throw new RangeError('Search scope intervals require the real domain');
  }
  if (completeness === 'complete-in-interval' && interval === undefined) {
    throw new RangeError('Interval-complete scope requires an interval');
  }
  return Object.freeze({
    domain,
    completeness,
    ...(interval === undefined ? {} : {interval: normalizeRealInterval(interval)})
  });
}

export function parametricResult(
  target: string,
  families: readonly ParametricFamily[]
): ParametricSolutions {
  const frozenFamilies = Object.freeze(families.map((family) => {
    const evidence = family.verification.evidence;
    const verification = Object.freeze({
      ...family.verification,
      ...(evidence === undefined ? {} : {evidence: Object.freeze({
        ...evidence,
        ...(evidence.bracket === undefined
          ? {}
          : {bracket: Object.freeze([...evidence.bracket]) as readonly [number, number]})
      })})
    });
    return Object.freeze({
      ...family,
      parameters: Object.freeze(family.parameters.map((parameter) => Object.freeze({
        ...parameter
      }))),
      conditions: Object.freeze([...family.conditions]),
      verification,
      ...(family.certificate === undefined ? {} : {certificate: Object.freeze({
        ...family.certificate
      })})
    });
  }));
  return Object.freeze({
    kind: 'parametric',
    target,
    domain: 'real',
    families: frozenFamilies,
    completeness: 'complete'
  });
}

export function unsupportedResult(
  target: string,
  reason: UnsupportedReason
): UnsupportedResult {
  return Object.freeze({kind: 'unsupported', target, reason});
}

export function limitResult(target: string, limit: LimitKind): LimitResult {
  return Object.freeze({kind: 'limit', target, limit});
}
