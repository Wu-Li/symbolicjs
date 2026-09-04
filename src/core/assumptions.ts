import {domainImplies} from './domains.js';
import {
  createJudgment,
  predicateKey,
  samePredicateExpression
} from './predicate.js';
import type {
  Judgment,
  SymbolicEvidence,
  SymbolicPredicate,
  SymbolicProperty,
  TruthValue
} from './predicate.js';

export type AssumptionTruth = Exclude<TruthValue, 'unknown'>;

export interface Assumption {
  readonly predicate: SymbolicPredicate;
  readonly truth: AssumptionTruth;
}

const SIGN_VALUES: Readonly<Partial<Record<SymbolicProperty, string>>> = Object.freeze({
  zero: '0',
  nonzero: '-+',
  positive: '+',
  nonnegative: '0+',
  negative: '-',
  nonpositive: '-0'
});

function validatePredicate(predicate: SymbolicPredicate): void {
  if (
    !predicate ||
    typeof predicate !== 'object' ||
    !predicate.expression ||
    predicate.expression.isNode !== true ||
    (predicate.kind !== 'property' && predicate.kind !== 'domain')
  ) {
    throw new TypeError('A valid symbolic predicate is required');
  }
}

function frozenAssumption(
  predicate: SymbolicPredicate,
  truth: AssumptionTruth
): Assumption {
  validatePredicate(predicate);
  if (truth !== 'proven' && truth !== 'disproven') {
    throw new TypeError('Assumption truth must be proven or disproven');
  }
  return Object.freeze({predicate, truth});
}

function signImplies(source: SymbolicProperty, target: SymbolicProperty): boolean {
  const sourceSigns = SIGN_VALUES[source];
  const targetSigns = SIGN_VALUES[target];
  return sourceSigns !== undefined && targetSigns !== undefined &&
    [...sourceSigns].every((sign) => targetSigns.includes(sign));
}

function signConflict(left: SymbolicProperty, right: SymbolicProperty): boolean {
  const leftSigns = SIGN_VALUES[left];
  const rightSigns = SIGN_VALUES[right];
  return leftSigns !== undefined && rightSigns !== undefined &&
    ![...leftSigns].some((sign) => rightSigns.includes(sign));
}

export function predicateImplies(
  source: SymbolicPredicate,
  target: SymbolicPredicate
): boolean {
  if (!samePredicateExpression(source, target)) {
    return false;
  }
  if (predicateKey(source) === predicateKey(target)) {
    return true;
  }

  if (source.kind === 'domain') {
    if (target.kind === 'domain') {
      return domainImplies(source.domain, target.domain);
    }
    return target.property === 'defined' ||
      target.property === 'scalar' ||
      target.property === 'commutative';
  }

  if (target.kind === 'domain') {
    if (
      source.property === 'positive' ||
      source.property === 'nonnegative' ||
      source.property === 'negative' ||
      source.property === 'nonpositive' ||
      source.property === 'zero' ||
      source.property === 'nonzero'
    ) {
      return domainImplies('real', target.domain);
    }
    if (source.property === 'even' || source.property === 'odd') {
      return domainImplies('integer', target.domain);
    }
    return false;
  }

  if (signImplies(source.property, target.property)) {
    return true;
  }
  if (source.property === 'finite' && target.property === 'defined') {
    return true;
  }
  if (source.property === 'scalar' && target.property === 'commutative') {
    return true;
  }
  if (
    (SIGN_VALUES[source.property] !== undefined ||
      source.property === 'even' ||
      source.property === 'odd') &&
    (target.property === 'defined' ||
      target.property === 'scalar' ||
      target.property === 'commutative')
  ) {
    return true;
  }
  return false;
}

export function predicatesConflict(
  left: SymbolicPredicate,
  right: SymbolicPredicate
): boolean {
  if (!samePredicateExpression(left, right)) {
    return false;
  }
  if (left.kind !== 'property' || right.kind !== 'property') {
    return false;
  }
  if (signConflict(left.property, right.property)) {
    return true;
  }
  return (left.property === 'even' && right.property === 'odd') ||
    (left.property === 'odd' && right.property === 'even');
}

function propertyLike(
  predicate: SymbolicPredicate,
  property: SymbolicProperty
): SymbolicPredicate {
  return Object.freeze({
    kind: 'property',
    property,
    expression: predicate.expression
  });
}

function simpleQuery(
  assumptions: readonly Assumption[],
  predicate: SymbolicPredicate
): Judgment {
  const key = predicateKey(predicate);
  const exact = assumptions.find((entry) => predicateKey(entry.predicate) === key);
  if (exact) {
    return createJudgment(exact.truth, [], [{
      source: 'assumption',
      detail: key
    }]);
  }

  for (const entry of assumptions) {
    if (entry.truth === 'proven' && predicateImplies(entry.predicate, predicate)) {
      return createJudgment('proven', [], [{
        source: 'implication',
        detail: `${predicateKey(entry.predicate)}=>${key}`
      }]);
    }
    if (entry.truth === 'proven' && predicatesConflict(entry.predicate, predicate)) {
      return createJudgment('disproven', [], [{
        source: 'implication',
        detail: `${predicateKey(entry.predicate)}!${key}`
      }]);
    }
    if (entry.truth === 'disproven' && predicateImplies(predicate, entry.predicate)) {
      return createJudgment('disproven', [], [{
        source: 'implication',
        detail: `${key}=>not(${predicateKey(entry.predicate)})`
      }]);
    }
  }

  return createJudgment('unknown', [predicate]);
}

function combinedQuery(
  assumptions: readonly Assumption[],
  predicate: SymbolicPredicate
): Judgment {
  const direct = simpleQuery(assumptions, predicate);
  if (direct.truth !== 'unknown' || predicate.kind !== 'property') {
    return direct;
  }

  let required: readonly SymbolicProperty[] | undefined;
  if (predicate.property === 'positive') {
    required = ['nonnegative', 'nonzero'];
  } else if (predicate.property === 'negative') {
    required = ['nonpositive', 'nonzero'];
  } else if (predicate.property === 'zero') {
    required = ['nonnegative', 'nonpositive'];
  }
  if (!required) {
    return direct;
  }

  const judgments = required.map((property) =>
    simpleQuery(assumptions, propertyLike(predicate, property))
  );
  if (judgments.every((judgment) => judgment.truth === 'proven')) {
    const evidence: SymbolicEvidence[] = judgments.flatMap((judgment) =>
      judgment.evidence
    );
    evidence.push({
      source: 'implication',
      detail: `${required.join('&')}=>${predicate.property}`
    });
    return createJudgment('proven', [], evidence);
  }
  if (judgments.some((judgment) => judgment.truth === 'disproven')) {
    return createJudgment('disproven', [], [{
      source: 'implication',
      detail: `requirements-for-${predicate.property}-conflict`
    }]);
  }
  return direct;
}

function validateConsistency(assumptions: readonly Assumption[]): void {
  const proven = assumptions.filter((entry) => entry.truth === 'proven');
  const disproven = assumptions.filter((entry) => entry.truth === 'disproven');

  for (let left = 0; left < proven.length; left += 1) {
    for (let right = left + 1; right < proven.length; right += 1) {
      if (predicatesConflict(proven[left]!.predicate, proven[right]!.predicate)) {
        throw new RangeError('Contradictory symbolic assumptions');
      }
    }
  }

  for (const entry of disproven) {
    if (combinedQuery(proven, entry.predicate).truth === 'proven') {
      throw new RangeError('Contradictory symbolic assumptions');
    }
  }
}

/** Immutable, persistently extended collection of symbolic facts. */
export class AssumptionSet {
  readonly #assumptions: readonly Assumption[];

  constructor(assumptions: Iterable<Assumption> = []) {
    const unique = new Map<string, Assumption>();
    for (const entry of assumptions) {
      const normalized = frozenAssumption(entry.predicate, entry.truth);
      unique.set(`${normalized.truth}:${predicateKey(normalized.predicate)}`, normalized);
    }
    const values = Object.freeze([...unique.values()].sort((left, right) =>
      `${left.truth}:${predicateKey(left.predicate)}`
        .localeCompare(`${right.truth}:${predicateKey(right.predicate)}`)
    ));
    validateConsistency(values);
    this.#assumptions = values;
    Object.freeze(this);
  }

  get size(): number {
    return this.#assumptions.length;
  }

  entries(): readonly Assumption[] {
    return this.#assumptions;
  }

  ask(predicate: SymbolicPredicate): Judgment {
    validatePredicate(predicate);
    return combinedQuery(this.#assumptions, predicate);
  }

  with(
    predicate: SymbolicPredicate,
    truth: AssumptionTruth = 'proven'
  ): AssumptionSet {
    const normalized = frozenAssumption(predicate, truth);
    const existing = this.#assumptions.find((entry) =>
      entry.truth === normalized.truth &&
      predicateKey(entry.predicate) === predicateKey(normalized.predicate)
    );
    return existing
      ? this
      : new AssumptionSet([...this.#assumptions, normalized]);
  }

  withAll(assumptions: Iterable<Assumption>): AssumptionSet {
    let result: AssumptionSet = this;
    for (const entry of assumptions) {
      result = result.with(entry.predicate, entry.truth);
    }
    return result;
  }
}

export function assume(
  predicate: SymbolicPredicate,
  truth: AssumptionTruth = 'proven'
): Assumption {
  return frozenAssumption(predicate, truth);
}
