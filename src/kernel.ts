import {isSymbolNode} from 'mathjs';
import type {MathJsInstance, MathNode} from 'mathjs';
import {conditionToPredicate, predicateToCondition} from './core/legacy-condition.js';
import type {Assumption} from './core/assumptions.js';
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
  OperatorNode?: MathJsInstance['OperatorNode'];
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

export class SymbolicKernel {
  readonly #simplifyCore: KernelDependencies['simplifyCore'];
  readonly #symbolic: SymbolicContext;

  constructor(dependencies: KernelDependencies) {
    this.#simplifyCore = dependencies.simplifyCore;
    this.#symbolic = dependencies.symbolic;
  }

  get symbolic(): SymbolicContext {
    return this.#symbolic;
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

  canonicalKey(node: MathNode): string {
    const canonical = this.#symbolic.canonicalize(node, {
      profile: 'scalar',
      domain: 'real',
      mode: 'conditional'
    }).expression;
    if (this.#symbolic.algebra.freeSymbols(canonical).length === 0) {
      const evaluated = this.#symbolic.algebra.evaluate(canonical, {domain: 'real'});
      if (evaluated.kind === 'value' && typeof evaluated.value === 'number' && Number.isFinite(evaluated.value)) {
        const value = evaluated.value === 0 ? 0 : evaluated.value;
        return 'number:' + value.toString();
      }
    }
    const key = this.#symbolic.structure.key(canonical, {parentheses: 'transparent'});
    return 'canonical:' +
      this.#symbolic.structure.fingerprint(canonical, {parentheses: 'transparent'}) + ':' + key;
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

    const normalized = this.normalizeConditions([
      ...conditions,
      ...this.conditionsForDefinedness(this.substitute(equation.lhs, target, candidate)),
      ...this.conditionsForDefinedness(this.substitute(equation.rhs, target, candidate))
    ]);
    if (normalized.contradictory) {
      return frozenVerification('rejected', 'contradictory-conditions');
    }

    const assumptions: Assumption[] = normalized.conditions.map((condition) => ({
      predicate: conditionToPredicate(this.#symbolic.predicates, condition),
      truth: 'proven'
    }));
    const verification = this.#symbolic.verifySubstitution(
      equation.lhs,
      equation.rhs,
      target,
      candidate,
      {
        domain: 'real',
        mode: 'conditional',
        assumptions,
        tolerance
      }
    );

    if (verification.status === 'proven') {
      return frozenVerification('proven');
    }
    if (verification.status === 'rejected') {
      const reason = verification.reason === 'counterexample'
        ? 'sample-mismatch'
        : verification.reason;
      return frozenVerification('rejected', reason);
    }
    return frozenVerification('inconclusive', verification.reason);
  }
}

export const createSymbolicKernel = customFactory(
  'symbolicKernel',
  ['simplifyCore', 'symbolic'],
  (rawDependencies) => new SymbolicKernel(
    rawDependencies as unknown as KernelDependencies
  )
);
