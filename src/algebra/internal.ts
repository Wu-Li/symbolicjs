import type {MathNode} from 'mathjs';
import type {OperationLimitExceeded} from '../core/operation-context.js';
import {predicateKey} from '../core/predicate.js';
import type {SymbolicPredicate} from '../core/predicate.js';
import type {
  AlgebraLimits,
  AlgebraNotRepresentable,
  AlgebraNotRepresentableReason,
  AlgebraViewResult,
  AlgebraViewSuccess
} from './types.js';

export const DEFAULT_ALGEBRA_LIMITS: AlgebraLimits = Object.freeze({
  maximumNodes: 100_000,
  maximumDepth: 1_000,
  maximumDegree: 128,
  maximumMonomials: 10_000,
  maximumConvolutions: 100_000,
  maximumRebuildNodes: 100_000
});

function nonnegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

function positiveSafeInteger(value: number, label: string): number {
  const normalized = nonnegativeSafeInteger(value, label);
  if (normalized === 0) {
    throw new RangeError(`${label} must be positive`);
  }
  return normalized;
}

export function normalizeAlgebraLimits(
  supplied: Partial<AlgebraLimits> = {}
): AlgebraLimits {
  const limits = {...DEFAULT_ALGEBRA_LIMITS, ...supplied};
  return Object.freeze({
    maximumNodes: positiveSafeInteger(limits.maximumNodes, 'maximumNodes'),
    maximumDepth: positiveSafeInteger(limits.maximumDepth, 'maximumDepth'),
    maximumDegree: nonnegativeSafeInteger(limits.maximumDegree, 'maximumDegree'),
    maximumMonomials: positiveSafeInteger(
      limits.maximumMonomials,
      'maximumMonomials'
    ),
    maximumConvolutions: nonnegativeSafeInteger(
      limits.maximumConvolutions,
      'maximumConvolutions'
    ),
    maximumRebuildNodes: positiveSafeInteger(
      limits.maximumRebuildNodes,
      'maximumRebuildNodes'
    )
  });
}

export function freezeRequirements(
  requirements: Iterable<SymbolicPredicate>
): readonly SymbolicPredicate[] {
  const unique = new Map<string, SymbolicPredicate>();
  for (const requirement of requirements) {
    unique.set(predicateKey(requirement), requirement);
  }
  return Object.freeze([...unique.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, requirement]) => requirement));
}

export function viewSuccess<T>(view: T): AlgebraViewSuccess<T> {
  return Object.freeze({kind: 'view', view});
}

export function notRepresentable(
  expression: MathNode,
  reason: AlgebraNotRepresentableReason,
  detail?: string
): AlgebraNotRepresentable {
  return Object.freeze(detail === undefined
    ? {kind: 'not-representable', reason, expression}
    : {kind: 'not-representable', reason, expression, detail});
}

export function algebraLimit(
  limit: string,
  used: number,
  maximum: number
): OperationLimitExceeded {
  return Object.freeze({kind: 'limit', limit, used, maximum});
}

export function isAlgebraFailure<T>(
  value: AlgebraViewResult<T>
): value is Exclude<AlgebraViewResult<T>, AlgebraViewSuccess<T>> {
  return value.kind !== 'view';
}

export function exponentKey(exponents: readonly number[]): string {
  return exponents.join(',');
}

export function totalDegree(exponents: readonly number[]): number {
  return exponents.reduce((sum, exponent) => sum + exponent, 0);
}

export function compareExponentVectors(
  left: readonly number[],
  right: readonly number[]
): number {
  const degree = totalDegree(right) - totalDegree(left);
  if (degree !== 0) {
    return degree;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const compared = (right[index] ?? 0) - (left[index] ?? 0);
    if (compared !== 0) {
      return compared;
    }
  }
  return 0;
}
