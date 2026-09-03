import {
  isConstantNode,
  isFunctionNode,
  isOperatorNode,
  isSymbolNode
} from 'mathjs';
import type {MathJsInstance, MathNode} from 'mathjs';
import {nodeSymbols} from './analysis.js';
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
}

export interface NormalizedConditions {
  readonly conditions: readonly Condition[];
  readonly contradictory: boolean;
}

const SIGN_SETS: Readonly<Record<Exclude<ConditionKind, 'defined'>, string>> = {
  zero: '0',
  nonzero: '-+',
  positive: '+',
  nonnegative: '0+',
  negative: '-',
  nonpositive: '-0'
};

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

function conditionHolds(condition: Condition, scope: Record<string, number>): boolean {
  try {
    const value = condition.expression.compile().evaluate(scope);
    const numeric = asFiniteNumber(value);
    switch (condition.kind) {
      case 'zero': return numeric === 0;
      case 'nonzero': return numeric !== null && numeric !== 0;
      case 'positive': return numeric !== null && numeric > 0;
      case 'nonnegative': return numeric !== null && numeric >= 0;
      case 'negative': return numeric !== null && numeric < 0;
      case 'nonpositive': return numeric !== null && numeric <= 0;
      case 'defined': return numeric !== null || typeof value === 'boolean';
    }
  } catch {
    return false;
  }
}

function constantConditionHolds(condition: Condition): boolean | null {
  if (nodeSymbols(condition.expression).length > 0) {
    return null;
  }
  return conditionHolds(condition, {});
}

function isClose(lhs: unknown, rhs: unknown, tolerance: number): boolean | null {
  const left = asFiniteNumber(lhs);
  const right = asFiniteNumber(rhs);
  if (left === null || right === null) {
    return typeof lhs === 'boolean' && typeof rhs === 'boolean'
      ? lhs === rhs
      : null;
  }
  return Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
}

export class SymbolicKernel {
  readonly #OperatorNode: KernelDependencies['OperatorNode'];
  readonly #simplifyCore: KernelDependencies['simplifyCore'];

  constructor(dependencies: KernelDependencies) {
    this.#OperatorNode = dependencies.OperatorNode;
    this.#simplifyCore = dependencies.simplifyCore;
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
    return this.#simplifyCore(node) as MathNode;
  }

  condition(kind: ConditionKind, expression: MathNode): Condition {
    if (!expression?.isNode) {
      throw new TypeError('MathJS node expected for condition');
    }
    return Object.freeze({kind, expression});
  }

  conditionsForDefinedness(node: MathNode): readonly Condition[] {
    const conditions: Condition[] = [];
    node.traverse((candidate) => {
      if (isOperatorNode(candidate) && candidate.op === '/') {
        conditions.push(this.condition('nonzero', candidate.args[1]!));
      }
      if (isOperatorNode(candidate) && candidate.op === '^') {
        const exponent = candidate.args[1];
        if (exponent) {
          const value = constantNodeValue(exponent);
          if (value !== null && value < 0) {
            conditions.push(this.condition('nonzero', candidate.args[0]!));
          }
          if (value !== null && !Number.isInteger(value)) {
            conditions.push(this.condition('nonnegative', candidate.args[0]!));
          }
        }
      }
      if (isFunctionNode(candidate)) {
        const name = isSymbolNode(candidate.fn) ? candidate.fn.name : '';
        if (name === 'sqrt') {
          conditions.push(this.condition('nonnegative', candidate.args[0]!));
        } else if (name === 'log' || name === 'log10') {
          conditions.push(this.condition('positive', candidate.args[0]!));
        } else if (name === 'nthRoot') {
          const degree = candidate.args[1];
          if (degree && isConstantNode(degree)) {
            const value = asFiniteNumber(degree.value);
            if (value !== null && Number.isInteger(value) && value % 2 === 0) {
              conditions.push(this.condition('nonnegative', candidate.args[0]!));
            }
          }
        }
      }
    });
    return this.normalizeConditions(conditions).conditions;
  }

  normalizeConditions(conditions: readonly Condition[]): NormalizedConditions {
    const unique = new Map<string, Condition>();
    const signs = new Map<string, Set<string>>();

    for (const condition of conditions) {
      const expression = this.simplify(condition.expression);
      const normalized = this.condition(condition.kind, expression);
      const constant = constantConditionHolds(normalized);
      if (constant === true) {
        continue;
      }
      if (constant === false) {
        return Object.freeze({conditions: Object.freeze([]), contradictory: true});
      }
      const expressionKey = expression.toString();
      const key = condition.kind + ':' + expressionKey;
      unique.set(key, normalized);
      if (condition.kind !== 'defined') {
        const allowed = new Set(SIGN_SETS[condition.kind]);
        const existing = signs.get(expressionKey);
        signs.set(
          expressionKey,
          existing
            ? new Set([...existing].filter((sign) => allowed.has(sign)))
            : allowed
        );
      }
    }

    if ([...signs.values()].some((allowed) => allowed.size === 0)) {
      return Object.freeze({conditions: Object.freeze([]), contradictory: true});
    }
    return Object.freeze({
      conditions: Object.freeze([...unique.values()].sort((lhs, rhs) =>
        (lhs.kind + ':' + lhs.expression.toString())
          .localeCompare(rhs.kind + ':' + rhs.expression.toString())
      )),
      contradictory: false
    });
  }

  canonicalKey(node: MathNode): string {
    return this.simplify(node).toString({parenthesis: 'all'});
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
      const value = asFiniteNumber(residual.value);
      return value === 0
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
      if (!normalized.conditions.every((condition) => conditionHolds(condition, scope))) {
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
  ['OperatorNode', 'simplifyCore'],
  (rawDependencies) => new SymbolicKernel(
    rawDependencies as unknown as KernelDependencies
  )
);
