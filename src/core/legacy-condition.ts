import type {Condition, ConditionKind} from '../solve-types.js';
import {PredicateFactory} from './predicate.js';
import type {SymbolicPredicate, SymbolicProperty} from './predicate.js';

const CONDITION_PROPERTIES: Readonly<Record<ConditionKind, SymbolicProperty>> =
  Object.freeze({
    zero: 'zero',
    nonzero: 'nonzero',
    positive: 'positive',
    nonnegative: 'nonnegative',
    negative: 'negative',
    nonpositive: 'nonpositive',
    defined: 'defined'
  });

export function conditionToPredicate(
  factory: PredicateFactory,
  condition: Condition
): SymbolicPredicate {
  return factory.property(
    CONDITION_PROPERTIES[condition.kind],
    condition.expression
  );
}

export function predicateToCondition(
  predicate: SymbolicPredicate
): Condition | null {
  if (predicate.kind !== 'property') {
    return null;
  }
  const kind = Object.entries(CONDITION_PROPERTIES).find(([, property]) =>
    property === predicate.property
  )?.[0] as ConditionKind | undefined;
  return kind
    ? Object.freeze({kind, expression: predicate.expression})
    : null;
}
