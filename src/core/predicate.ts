import type {MathNode} from 'mathjs';
import type {SymbolicDomain} from './domains.js';
import {MathAdapter} from './math-adapter.js';

export type TruthValue = 'proven' | 'disproven' | 'unknown';

export type SymbolicProperty =
  | 'zero'
  | 'nonzero'
  | 'positive'
  | 'nonnegative'
  | 'negative'
  | 'nonpositive'
  | 'finite'
  | 'defined'
  | 'even'
  | 'odd'
  | 'scalar'
  | 'commutative';

export interface PropertyPredicate {
  readonly kind: 'property';
  readonly property: SymbolicProperty;
  readonly expression: MathNode;
}

export interface DomainPredicate {
  readonly kind: 'domain';
  readonly domain: SymbolicDomain;
  readonly expression: MathNode;
}

export type SymbolicPredicate = PropertyPredicate | DomainPredicate;

export interface SymbolicEvidence {
  readonly source:
    | 'assumption'
    | 'implication'
    | 'evaluation'
    | 'structure'
    | 'registry';
  readonly detail?: string;
}

export interface Judgment {
  readonly truth: TruthValue;
  readonly requirements: readonly SymbolicPredicate[];
  readonly evidence: readonly SymbolicEvidence[];
}

export type RequirementResult =
  | {
    readonly kind: 'satisfied';
    readonly judgment: Judgment;
  }
  | {
    readonly kind: 'rejected';
    readonly reason: 'disproven' | 'unproven';
    readonly judgment: Judgment;
  }
  | {
    readonly kind: 'conditional';
    readonly requirements: readonly SymbolicPredicate[];
    readonly judgment: Judgment;
  };

function canonicalJson(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return {$bigint: value.toString()};
  }
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)])
    );
  }
  return value;
}

/** Provisional structural identity; Chapter 3 replaces this implementation. */
export function predicateExpressionKey(expression: MathNode): string {
  try {
    const serialized = JSON.stringify(expression, (_key, value) =>
      typeof value === 'bigint' ? {$bigint: value.toString()} : value
    );
    return JSON.stringify(canonicalJson(JSON.parse(serialized)));
  } catch {
    return `${expression.type}:${expression.toString({parenthesis: 'all'})}`;
  }
}

export function predicateKey(predicate: SymbolicPredicate): string {
  const qualifier = predicate.kind === 'domain'
    ? predicate.domain
    : predicate.property;
  return `${predicate.kind}:${qualifier}:${predicateExpressionKey(predicate.expression)}`;
}

export function samePredicateExpression(
  left: SymbolicPredicate,
  right: SymbolicPredicate
): boolean {
  return predicateExpressionKey(left.expression) ===
    predicateExpressionKey(right.expression);
}

export function oppositePredicate(
  predicate: SymbolicPredicate
): SymbolicPredicate | null {
  if (predicate.kind === 'domain') {
    return null;
  }
  const opposite: Partial<Record<SymbolicProperty, SymbolicProperty>> = {
    zero: 'nonzero',
    nonzero: 'zero',
    positive: 'nonpositive',
    nonpositive: 'positive',
    negative: 'nonnegative',
    nonnegative: 'negative',
    even: 'odd',
    odd: 'even'
  };
  const property = opposite[predicate.property];
  return property
    ? Object.freeze({kind: 'property', property, expression: predicate.expression})
    : null;
}

export function createJudgment(
  truth: TruthValue,
  requirements: readonly SymbolicPredicate[] = [],
  evidence: readonly SymbolicEvidence[] = []
): Judgment {
  return Object.freeze({
    truth,
    requirements: Object.freeze([...requirements]),
    evidence: Object.freeze(evidence.map((entry) => Object.freeze({...entry})))
  });
}

/** Validates and creates immutable predicates over MathJS nodes. */
export class PredicateFactory {
  readonly #math: MathAdapter;

  constructor(math: MathAdapter) {
    this.#math = math;
    Object.freeze(this);
  }

  property(property: SymbolicProperty, expression: MathNode): PropertyPredicate {
    this.#assertNode(expression);
    return Object.freeze({kind: 'property', property, expression});
  }

  domain(expression: MathNode, domain: SymbolicDomain): DomainPredicate {
    this.#assertNode(expression);
    return Object.freeze({kind: 'domain', domain, expression});
  }

  integer(expression: MathNode): DomainPredicate {
    return this.domain(expression, 'integer');
  }

  rational(expression: MathNode): DomainPredicate {
    return this.domain(expression, 'rational');
  }

  real(expression: MathNode): DomainPredicate {
    return this.domain(expression, 'real');
  }

  complex(expression: MathNode): DomainPredicate {
    return this.domain(expression, 'complex');
  }

  zero(expression: MathNode): PropertyPredicate {
    return this.property('zero', expression);
  }

  nonzero(expression: MathNode): PropertyPredicate {
    return this.property('nonzero', expression);
  }

  positive(expression: MathNode): PropertyPredicate {
    return this.property('positive', expression);
  }

  nonnegative(expression: MathNode): PropertyPredicate {
    return this.property('nonnegative', expression);
  }

  negative(expression: MathNode): PropertyPredicate {
    return this.property('negative', expression);
  }

  nonpositive(expression: MathNode): PropertyPredicate {
    return this.property('nonpositive', expression);
  }

  finite(expression: MathNode): PropertyPredicate {
    return this.property('finite', expression);
  }

  defined(expression: MathNode): PropertyPredicate {
    return this.property('defined', expression);
  }

  even(expression: MathNode): PropertyPredicate {
    return this.property('even', expression);
  }

  odd(expression: MathNode): PropertyPredicate {
    return this.property('odd', expression);
  }

  scalar(expression: MathNode): PropertyPredicate {
    return this.property('scalar', expression);
  }

  commutative(expression: MathNode): PropertyPredicate {
    return this.property('commutative', expression);
  }

  #assertNode(expression: MathNode): void {
    if (!this.#math.isNode(expression)) {
      throw new TypeError('MathJS node expected for symbolic predicate');
    }
  }
}
