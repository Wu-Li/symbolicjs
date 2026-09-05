import type {MathNode} from 'mathjs';
import type {CanonicalizationProfile} from './canonicalize/types.js';
import type {OperationContext} from './operation-context.js';
import type {SymbolicPredicate} from './predicate.js';
import {predicateKey} from './predicate.js';
import {AlgebraEngine} from '../algebra/engine.js';
import {CanonicalizationEngine} from './canonicalize/engine.js';
import {StructuralEngine} from './structure.js';

export type EquivalenceTruth = 'proven' | 'disproven' | 'unknown';

export type EquivalenceEvidenceKind =
  | 'structural-identity'
  | 'canonical-identity'
  | 'polynomial-coefficients'
  | 'rational-cross-product'
  | 'numeric-counterexample';

export interface EquivalenceEvidence {
  readonly kind: EquivalenceEvidenceKind;
  readonly detail?: string;
}

export interface EquivalenceResult {
  readonly truth: EquivalenceTruth;
  readonly profile: CanonicalizationProfile;
  readonly requirements: readonly SymbolicPredicate[];
  readonly evidence: readonly EquivalenceEvidence[];
}

export interface EquivalenceOptions {
  readonly profile?: CanonicalizationProfile;
  readonly generators?: readonly string[];
}

function freezeRequirements(
  requirements: readonly SymbolicPredicate[]
): readonly SymbolicPredicate[] {
  const unique = new Map<string, SymbolicPredicate>();
  for (const requirement of requirements) {
    unique.set(predicateKey(requirement), requirement);
  }
  return Object.freeze([...unique.values()]);
}

function result(
  truth: EquivalenceTruth,
  profile: CanonicalizationProfile,
  requirements: readonly SymbolicPredicate[] = [],
  evidence: readonly EquivalenceEvidence[] = []
): EquivalenceResult {
  return Object.freeze({
    truth,
    profile,
    requirements: freezeRequirements(requirements),
    evidence: Object.freeze(evidence.map((entry) => Object.freeze({...entry})))
  });
}

/** Conservative staged equivalence over MathJS nodes. */
export class EquivalenceEngine {
  readonly #structure: StructuralEngine;
  readonly #canonicalization: CanonicalizationEngine;
  readonly #algebra: AlgebraEngine;

  constructor(
    structure: StructuralEngine,
    canonicalization: CanonicalizationEngine,
    algebra: AlgebraEngine
  ) {
    this.#structure = structure;
    this.#canonicalization = canonicalization;
    this.#algebra = algebra;
    Object.freeze(this);
  }

  equivalent(
    left: MathNode,
    right: MathNode,
    context: OperationContext,
    options: EquivalenceOptions = {}
  ): EquivalenceResult {
    const profile = options.profile ?? 'scalar';

    if (this.#structure.equals(left, right, {parentheses: 'preserve'})) {
      return result('proven', profile, [], [{kind: 'structural-identity'}]);
    }

    const leftCanonical = this.#canonicalization.canonicalize(left, context, {profile});
    const rightCanonical = this.#canonicalization.canonicalize(right, context, {profile});
    if (!leftCanonical.limit && !rightCanonical.limit &&
      this.#structure.equals(
        leftCanonical.expression,
        rightCanonical.expression,
        {parentheses: 'preserve'}
      )) {
      return result(
        'proven',
        profile,
        [...leftCanonical.requirements, ...rightCanonical.requirements],
        [{kind: 'canonical-identity'}]
      );
    }

    const generators = options.generators ?? Array.from(new Set([
      ...this.#algebra.freeSymbols(left),
      ...this.#algebra.freeSymbols(right)
    ])).sort();

    if (generators.length > 0) {
      const leftPolynomial = this.#algebra.polynomial(left, {
        generators,
        domain: context.domain,
        assumptions: context.assumptions,
        scope: context.scope,
        mode: context.mode
      });
      const rightPolynomial = this.#algebra.polynomial(right, {
        generators,
        domain: context.domain,
        assumptions: context.assumptions,
        scope: context.scope,
        mode: context.mode
      });
      if (leftPolynomial.kind === 'view' && rightPolynomial.kind === 'view') {
        const rebuiltLeft = leftPolynomial.view.rebuild();
        const rebuiltRight = rightPolynomial.view.rebuild();
        if (this.#structure.equals(rebuiltLeft, rebuiltRight, {parentheses: 'preserve'})) {
          return result(
            'proven',
            profile,
            [...leftPolynomial.view.requirements, ...rightPolynomial.view.requirements],
            [{kind: 'polynomial-coefficients'}]
          );
        }
      }

      const leftRational = this.#algebra.rational(left, {
        generators,
        domain: context.domain,
        assumptions: context.assumptions,
        scope: context.scope,
        mode: context.mode
      });
      const rightRational = this.#algebra.rational(right, {
        generators,
        domain: context.domain,
        assumptions: context.assumptions,
        scope: context.scope,
        mode: context.mode
      });
      if (leftRational.kind === 'view' && rightRational.kind === 'view') {
        const leftCross = context.nodes.operator('*', 'multiply', [
          leftRational.view.numerator.rebuild(),
          rightRational.view.denominator.rebuild()
        ]);
        const rightCross = context.nodes.operator('*', 'multiply', [
          rightRational.view.numerator.rebuild(),
          leftRational.view.denominator.rebuild()
        ]);
        const leftNormalized = this.#canonicalization.canonicalize(leftCross, context, {profile: 'scalar'});
        const rightNormalized = this.#canonicalization.canonicalize(rightCross, context, {profile: 'scalar'});
        if (!leftNormalized.limit && !rightNormalized.limit &&
          this.#structure.equals(
            leftNormalized.expression,
            rightNormalized.expression,
            {parentheses: 'preserve'}
          )) {
          return result(
            'proven',
            profile,
            [
              ...leftRational.view.requirements,
              ...rightRational.view.requirements,
              ...leftNormalized.requirements,
              ...rightNormalized.requirements
            ],
            [{kind: 'rational-cross-product'}]
          );
        }
      }
    }

    return result('unknown', profile);
  }
}
