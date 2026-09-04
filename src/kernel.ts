import {
  isConstantNode,
  isFunctionNode,
  isOperatorNode,
  isSymbolNode
} from 'mathjs';
import type {MathJsInstance, MathNode} from 'mathjs';
import {nodeSymbols} from './analysis.js';
import {conditionToPredicate, predicateToCondition} from './core/legacy-condition.js';
import type {SymbolicContext} from './core/symbolic-context.js';
import {customFactory} from './custom-factory.js';
import {DEFAULT_SOLVE_TOLERANCE} from './solve-types.js';
import type {
  Condition,
  ConditionKind,
  VerificationResult
} from './solve-types.js';
import type {EqualityNode} from './types.js';

interface KernelDependencies {
  OperatorNode: MathJsInstance['OperatorNode'];
  simplifyCore: MathJsInstance['simplifyCore'];
  symbolic: SymbolicContext;
}

export interface NormalizedConditions {
  readonly conditions: readonly Condition[];
  readonly contradictory: boolean;
}

function frozenVerification(
  status: VerificationResult['status'],
  reason?: string
): VerificationResult {
  return Object.freeze(reason ? {status, reason} : {status});
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'bigint') {
    const converted = Number(value);
    return Number.isFinite(converted) ? converted : null;
  }
  if (
    value &&
    typeof value === 'object' &&
    'toNumber' in value &&
    typeof value.toNumber === 'function'
  ) {
    const converted = value.toNumber();
    return Number.isFinite(converted) ? converted : null;
  }
  return null;
}

interface FiniteScalar {
  readonly re: number;
  readonly im: number;
}

function asFiniteScalar(value: unknown): FiniteScalar | null {
  const real = asFiniteNumber(value);
  if (real !== null) {
    return {re: real, im: 0};
  }
  if (
    value &&
    typeof value === 'object' &&
    're' in value &&
    'im' in value &&
    typeof value.re === 'number' &&
    typeof value.im === 'number' &&
    Number.isFinite(value.re) &&
    Number.isFinite(value.im)
  ) {
    return {re: value.re, im: value.im};
  }
  return null;
}

function constantNodeValue(node: MathNode): number | null {
  if (nodeSymbols(node).length > 0) {
    return null;
  }
  try {
    return asFiniteNumber(node.compile().evaluate());
  } catch {
    return null;
  }
}

function isClose(lhs: unknown, rhs: unknown, tolerance: number): boolean | null {
  const left = asFiniteScalar(lhs);
  const right = asFiniteScalar(rhs);
  if (left === null || right === null) {
    return typeof lhs === 'boolean' && typeof rhs === 'boolean'
      ? lhs === rhs
      : null;
  }
  const distance = Math.hypot(left.re - right.re, left.im - right.im);
  return distance <= tolerance * Math.max(
    1,
    Math.hypot(left.re, left.im),
    Math.hypot(right.re, right.im)
  );
}

export class SymbolicKernel {
  readonly #OperatorNode: KernelDependencies['OperatorNode'];
  readonly #simplifyCore: KernelDependencies['simplifyCore'];
  readonly #symbolic: SymbolicContext;

  constructor(dependencies: KernelDependencies) {
    this.#OperatorNode = dependencies.OperatorNode;
    this.#simplifyCore = dependencies.simplifyCore;
    this.#symbolic = dependencies.symbolic;
  }

  substitute(node: MathNode, target: string, replacement: MathNode): MathNode {
    if (!node?.isNode || !replacement?.isNode) {
      throw new TypeError('MathJS nodes expected for substitution');
    }
    return node.transform<MathNode>((candidate) =>
      isSymbolNode(candidate) && candidate.name === target
        ? replacement
        : candidate
    );
  }

  simplify(node: MathNode): MathNode {
    try {
      return this.#simplifyCore(node) as MathNode;
    } catch {
      // MathJS 15 cannot always convert an evaluated Complex value back into
      // a node (for example, simplifyCore(sqrt(-1))). Keeping the original
      // immutable tree is the conservative symbolic result.
      return node;
    }
  }

  condition(kind: ConditionKind, expression: MathNode): Condition {
    if (!expression?.isNode) {
      throw new TypeError('MathJS node expected for condition');
    }
    return Object.freeze({kind, expression});
  }

  conditionsForDefinedness(node: MathNode): readonly Condition[] {
    const analysis = this.#symbolic.definedness(node, {
      domain: 'real',
      mode: 'conditional',
      includeLeafDefinedness: false,
      legacySolverCompatibility: true
    });
    return Object.freeze(analysis.requirements
      .map((predicate) => predicateToCondition(predicate))
      .filter((condition): condition is Condition => condition !== null));
  }

  normalizeConditions(conditions: readonly Condition[]): NormalizedConditions {
    const unique = new Map<string, Condition>();
    let assumptions = this.#symbolic.assumptions();

    for (const condition of conditions) {
      const expression = this.simplify(condition.expression);
      const normalized = this.condition(condition.kind, expression);
      const predicate = conditionToPredicate(this.#symbolic.predicates, normalized);
      const judgment = this.#symbolic.ask(predicate, {domain: 'real'});
      if (judgment.truth === 'proven') {
        continue;
      }
      if (judgment.truth === 'disproven') {
        return Object.freeze({conditions: Object.freeze([]), contradictory: true});
      }
      try {
        assumptions = assumptions.with(predicate);
      } catch {
        return Object.freeze({conditions: Object.freeze([]), contradictory: true});
      }
      unique.set(condition.kind + ':' + expression.toString(), normalized);
    }

    return Object.freeze({
      conditions: Object.freeze([...unique.values()].sort((lhs, rhs) =>
        (lhs.kind + ':' + lhs.expression.toString())
          .localeCompare(rhs.kind + ':' + rhs.expression.toString())
      )),
      contradictory: false
    });
  }

  #conditionHolds(condition: Condition, scope: Record<string, number>): boolean {
    return this.#symbolic.ask(
      conditionToPredicate(this.#symbolic.predicates, condition),
      {domain: 'real', scope}
    ).truth === 'proven';
  }

  canonicalKey(node: MathNode): string {
    const canonical = this.#symbolic.canonicalize(node, {
      profile: 'scalar',
      domain: 'real',
      mode: 'conditional'
    }).expression;
    if (nodeSymbols(canonical).length === 0) {
      try {
        const value = asFiniteNumber(canonical.compile().evaluate());
        if (value !== null) {
          return 'number:' + (value === 0 ? '0' : value.toString());
        }
      } catch {
        // Fall through to the canonical structural identity.
      }
    }
    const key = this.#symbolic.structure.key(canonical, {
      parentheses: 'transparent'
    });
    return 'canonical:' +
      this.#symbolic.structure.fingerprint(canonical, {
        parentheses: 'transparent'
      }) + ':' + key;
  }

  verify(
    equation: EqualityNode,
    target: string,
    candidate: MathNode,
    conditions: readonly Condition[] = [],
    tolerance = DEFAULT_SOLVE_TOLERANCE
  ): VerificationResult {
    if (!Number.isFinite(tolerance) || tolerance <= 0) {
      throw new RangeError('Verification tolerance must be positive and finite');
    }
    const lhs = this.simplify(this.substitute(equation.lhs, target, candidate));
    const rhs = this.simplify(this.substitute(equation.rhs, target, candidate));
    const normalized = this.normalizeConditions([
      ...conditions,
      ...this.conditionsForDefinedness(lhs),
      ...this.conditionsForDefinedness(rhs)
    ]);
    if (normalized.contradictory) {
      return frozenVerification('rejected', 'contradictory-conditions');
    }
    if (lhs.equals(rhs)) {
      return frozenVerification('proven');
    }

    const residual = this.simplify(new this.#OperatorNode(
      '-',
      'subtract',
      [lhs, rhs]
    ));
    if (isConstantNode(residual)) {
      const value = asFiniteScalar(residual.value);
      return value !== null && value.re === 0 && value.im === 0
        ? frozenVerification('proven')
        : frozenVerification('rejected', 'nonzero-residual');
    }

    const symbols = [...new Set([
      ...nodeSymbols(lhs),
      ...nodeSymbols(rhs),
      ...normalized.conditions.flatMap((condition) => nodeSymbols(condition.expression))
    ])].filter((symbol) => symbol !== target).sort();
    if (symbols.length === 0) {
      try {
        const close = isClose(lhs.compile().evaluate(), rhs.compile().evaluate(), tolerance);
        return close === true
          ? frozenVerification('proven')
          : frozenVerification('rejected', 'numeric-mismatch');
      } catch {
        return frozenVerification('rejected', 'undefined-candidate');
      }
    }

    const samples = [-3, -1, 0.5, 2, 5];
    let validSamples = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const scope = Object.fromEntries(symbols.map((symbol, symbolIndex) => [
        symbol,
        samples[(index + symbolIndex) % samples.length]!
      ]));
      if (!normalized.conditions.every((condition) => this.#conditionHolds(condition, scope))) {
        continue;
      }
      try {
        const close = isClose(
          lhs.compile().evaluate(scope),
          rhs.compile().evaluate(scope),
          tolerance
        );
        if (close === false) {
          return frozenVerification('rejected', 'sample-mismatch');
        }
        if (close === true) {
          validSamples += 1;
        }
      } catch {
        // An unusable sample is not evidence for or against the candidate.
      }
    }
    return frozenVerification(
      'inconclusive',
      validSamples > 0 ? 'numeric-evidence-only' : 'no-valid-samples'
    );
  }
}

export const createSymbolicKernel = customFactory(
  'symbolicKernel',
  ['OperatorNode', 'simplifyCore', 'symbolic'],
  (rawDependencies) => new SymbolicKernel(
    rawDependencies as unknown as KernelDependencies
  )
);
