import {isSymbolNode} from 'mathjs';
import type {MathNode} from 'mathjs';
import type {OperationContext, OperationContextOptions} from './operation-context.js';
import type {SymbolicPredicate} from './predicate.js';
import {predicateKey} from './predicate.js';
import {DefinednessAnalyzer} from './definedness.js';
import {EquivalenceEngine} from './equivalence.js';

export type VerificationTruth = 'proven' | 'rejected' | 'inconclusive';

export interface VerificationEvidence {
  readonly kind: 'equivalence' | 'numeric-residual' | 'numeric-counterexample';
  readonly detail?: string;
}

export interface ExpressionVerificationResult {
  readonly status: VerificationTruth;
  readonly reason?: string;
  readonly requirements: readonly SymbolicPredicate[];
  readonly evidence: readonly VerificationEvidence[];
}

export interface VerifyExpressionOptions extends OperationContextOptions {
  readonly tolerance?: number;
  readonly samples?: readonly number[];
}

function freezeRequirements(values: readonly SymbolicPredicate[]): readonly SymbolicPredicate[] {
  const unique = new Map<string, SymbolicPredicate>();
  for (const value of values) unique.set(predicateKey(value), value);
  return Object.freeze([...unique.values()]);
}

function result(
  status: VerificationTruth,
  reason: string | undefined,
  requirements: readonly SymbolicPredicate[],
  evidence: readonly VerificationEvidence[]
): ExpressionVerificationResult {
  return Object.freeze({
    status,
    ...(reason ? {reason} : {}),
    requirements: freezeRequirements(requirements),
    evidence: Object.freeze(evidence.map((entry) => Object.freeze({...entry})))
  });
}

function substitute(node: MathNode, target: string, replacement: MathNode): MathNode {
  return node.transform<MathNode>((candidate) =>
    isSymbolNode(candidate) && candidate.name === target ? replacement : candidate
  );
}

function finiteScalar(value: unknown): {re: number; im: number} | null {
  if (typeof value === 'number' && Number.isFinite(value)) return {re: value, im: 0};
  if (typeof value === 'bigint') {
    const converted = Number(value);
    return Number.isFinite(converted) ? {re: converted, im: 0} : null;
  }
  if (value && typeof value === 'object' && 're' in value && 'im' in value &&
    typeof value.re === 'number' && typeof value.im === 'number' &&
    Number.isFinite(value.re) && Number.isFinite(value.im)) {
    return {re: value.re, im: value.im};
  }
  if (value && typeof value === 'object' && 'toNumber' in value && typeof value.toNumber === 'function') {
    const converted = value.toNumber();
    return Number.isFinite(converted) ? {re: converted, im: 0} : null;
  }
  return null;
}

function close(left: unknown, right: unknown, tolerance: number): boolean | null {
  const lhs = finiteScalar(left);
  const rhs = finiteScalar(right);
  if (!lhs || !rhs) return null;
  const distance = Math.hypot(lhs.re - rhs.re, lhs.im - rhs.im);
  return distance <= tolerance * Math.max(1, Math.hypot(lhs.re, lhs.im), Math.hypot(rhs.re, rhs.im));
}

/** Reusable candidate/substitution verification built on shared semantic services. */
export class VerificationEngine {
  readonly #equivalence: EquivalenceEngine;
  readonly #definedness: DefinednessAnalyzer;

  constructor(equivalence: EquivalenceEngine, definedness: DefinednessAnalyzer) {
    this.#equivalence = equivalence;
    this.#definedness = definedness;
    Object.freeze(this);
  }

  verifySubstitution(
    left: MathNode,
    right: MathNode,
    target: string,
    candidate: MathNode,
    context: OperationContext,
    options: VerifyExpressionOptions = {}
  ): ExpressionVerificationResult {
    const tolerance = options.tolerance ?? 1e-10;
    if (!Number.isFinite(tolerance) || tolerance <= 0) {
      throw new RangeError('Verification tolerance must be positive and finite');
    }

    const lhs = substitute(left, target, candidate);
    const rhs = substitute(right, target, candidate);
    const requirements = [
      ...this.#definedness.requirements(lhs, {domain: context.domain}),
      ...this.#definedness.requirements(rhs, {domain: context.domain})
    ];

    const equivalent = this.#equivalence.equivalent(lhs, rhs, context);
    if (equivalent.truth === 'proven') {
      return result('proven', undefined, [...requirements, ...equivalent.requirements], [
        {kind: 'equivalence', detail: equivalent.evidence.map((entry) => entry.kind).join(',')}
      ]);
    }
    if (equivalent.truth === 'disproven') {
      return result('rejected', 'counterexample', [...requirements, ...equivalent.requirements], [
        {kind: 'numeric-counterexample'}
      ]);
    }

    const symbols = [...new Set([
      ...lhs.filter(isSymbolNode).map((node) => node.name),
      ...rhs.filter(isSymbolNode).map((node) => node.name)
    ])].filter((name) => name !== target).sort();

    if (symbols.length === 0) {
      try {
        const comparison = close(lhs.compile().evaluate(), rhs.compile().evaluate(), tolerance);
        if (comparison === true) {
          return result('proven', undefined, requirements, [{kind: 'numeric-residual'}]);
        }
        if (comparison === false) {
          return result('rejected', 'numeric-mismatch', requirements, [{kind: 'numeric-counterexample'}]);
        }
      } catch {
        return result('rejected', 'undefined-candidate', requirements, []);
      }
    }

    const samples = options.samples ?? [-3, -1, 0.5, 2, 5];
    let agreement = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const scope = Object.fromEntries(symbols.map((symbol, offset) => [
        symbol,
        samples[(index + offset) % samples.length]!
      ]));
      try {
        const comparison = close(
          lhs.compile().evaluate(scope),
          rhs.compile().evaluate(scope),
          tolerance
        );
        if (comparison === false) {
          return result('rejected', 'sample-mismatch', requirements, [{kind: 'numeric-counterexample'}]);
        }
        if (comparison === true) agreement += 1;
      } catch {
        // unusable samples are inconclusive
      }
    }

    return result(
      'inconclusive',
      agreement > 0 ? 'numeric-evidence-only' : 'no-valid-samples',
      requirements,
      agreement > 0 ? [{kind: 'numeric-residual'}] : []
    );
  }
}
