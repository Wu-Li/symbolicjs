import type {MathNode} from 'mathjs';
import type {OperationContext} from './operation-context.js';
import {PatternMatcher} from './matcher.js';
import {predicateKey} from './predicate.js';
import type {SymbolicPredicate} from './predicate.js';
import {StructuralEngine} from './structure.js';
import type {
  RewriteLimit,
  RewriteOptions,
  RewriteRule,
  RewriteStep,
  RewriteStrategy,
  TransformResult
} from './rewrite.js';

interface Limits {
  readonly steps: number;
  readonly branches: number;
  readonly states: number;
  readonly frontier: number;
  readonly nodeGrowth: number;
}

interface WorkState {
  readonly context: OperationContext;
  readonly limits: Limits;
  readonly initialNodes: number;
  readonly visited: Set<string>;
  steps: number;
  branches: number;
  states: number;
}

interface InternalResult {
  readonly node: MathNode;
  readonly changed: boolean;
  readonly requirements: readonly SymbolicPredicate[];
  readonly trace: readonly RewriteStep[];
  readonly limit?: RewriteLimit;
}

const DEFAULTS: Limits = Object.freeze({
  steps: 1_000,
  branches: 2_000,
  states: 2_000,
  frontier: 128,
  nodeGrowth: 10_000
});

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const actual = value ?? fallback;
  if (!Number.isSafeInteger(actual) || actual < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return actual;
}

function limits(options: RewriteOptions): Limits {
  return Object.freeze({
    steps: positiveInteger(options.maximumSteps, DEFAULTS.steps, 'maximumSteps'),
    branches: positiveInteger(options.maximumBranches, DEFAULTS.branches, 'maximumBranches'),
    states: positiveInteger(options.maximumStates, DEFAULTS.states, 'maximumStates'),
    frontier: positiveInteger(options.maximumFrontier, DEFAULTS.frontier, 'maximumFrontier'),
    nodeGrowth: positiveInteger(options.maximumNodeGrowth, DEFAULTS.nodeGrowth, 'maximumNodeGrowth')
  });
}

function mergeRequirements(...sets: readonly (readonly SymbolicPredicate[])[]): readonly SymbolicPredicate[] {
  const values = new Map<string, SymbolicPredicate>();
  for (const set of sets) {
    for (const requirement of set) values.set(predicateKey(requirement), requirement);
  }
  return Object.freeze([...values.values()]);
}

function result(
  node: MathNode,
  changed = false,
  requirements: readonly SymbolicPredicate[] = [],
  trace: readonly RewriteStep[] = [],
  limit?: RewriteLimit
): InternalResult {
  return Object.freeze({
    node,
    changed,
    requirements: Object.freeze([...requirements]),
    trace: Object.freeze([...trace]),
    ...(limit ? {limit} : {})
  });
}

/** Executes local rewrite rules through bounded deterministic strategies. */
export class RewriteEngine {
  readonly #matcher: PatternMatcher;
  readonly #structure: StructuralEngine;

  constructor(matcher: PatternMatcher, structure: StructuralEngine) {
    this.#matcher = matcher;
    this.#structure = structure;
    Object.freeze(this);
  }

  transform(
    node: MathNode,
    strategy: RewriteStrategy,
    context: OperationContext,
    options: RewriteOptions = {}
  ): TransformResult {
    if (!context.math.isNode(node)) throw new TypeError('MathJS node expected for rewrite');
    const state: WorkState = {
      context,
      limits: limits(options),
      initialNodes: this.#structure.cost(node).metrics.nodeCount,
      visited: new Set([this.#structure.fingerprint(node, {parentheses: 'preserve'})]),
      steps: 0,
      branches: 0,
      states: 1
    };
    const transformed = this.#apply(node, strategy, state);
    return Object.freeze({
      node: transformed.node,
      changed: transformed.changed,
      requirements: transformed.requirements,
      trace: transformed.trace,
      ...(transformed.limit ? {limit: transformed.limit} : {})
    });
  }

  #limit(state: WorkState, kind: RewriteLimit['limit'], used: number, maximum: number): RewriteLimit | null {
    return used > maximum ? Object.freeze({kind: 'limit', limit: kind, used, maximum}) : null;
  }

  #chargeStep(state: WorkState): RewriteLimit | null {
    state.steps += 1;
    return this.#limit(state, 'rewriteSteps', state.steps, state.limits.steps);
  }

  #chargeBranch(state: WorkState): RewriteLimit | null {
    state.branches += 1;
    return this.#limit(state, 'rewriteBranches', state.branches, state.limits.branches);
  }

  #register(node: MathNode, state: WorkState): RewriteLimit | null {
    const count = this.#structure.cost(node).metrics.nodeCount;
    const growth = Math.max(0, count - state.initialNodes);
    const growthLimit = this.#limit(state, 'rewriteNodeGrowth', growth, state.limits.nodeGrowth);
    if (growthLimit) return growthLimit;
    const key = this.#structure.fingerprint(node, {parentheses: 'preserve'});
    if (!state.visited.has(key)) {
      state.visited.add(key);
      state.states += 1;
    }
    return this.#limit(state, 'rewriteStates', state.states, state.limits.states);
  }

  #apply(node: MathNode, strategy: RewriteStrategy, state: WorkState): InternalResult {
    switch (strategy.kind) {
      case 'rule': return this.#rule(node, strategy.rule, state);
      case 'top-down': return this.#traverse(node, strategy.strategy, state, true);
      case 'bottom-up': return this.#traverse(node, strategy.strategy, state, false);
      case 'choice': return this.#choice(node, strategy.strategies, state);
      case 'sequence': return this.#sequence(node, strategy.strategies, state);
      case 'repeat': return this.#repeat(node, strategy.strategy, state);
      case 'best-of': return this.#best(node, strategy.strategies, state, false);
      case 'best-first': return this.#bestFirst(node, strategy.strategies, state);
      case 'branch': return this.#best(node, strategy.strategies, state, true);
    }
  }

  #rule(node: MathNode, rule: RewriteRule, state: WorkState): InternalResult {
    const stepLimit = this.#chargeStep(state);
    if (stepLimit) return result(node, false, [], [], stepLimit);
    const matchMaximum = Math.min(
      state.context.limits.matchBranches ?? state.limits.branches,
      state.limits.branches
    );
    const matchContext = state.context.with({limits: {matchBranches: matchMaximum}});
    const matched = this.#matcher.match(node, rule.pattern, matchContext);
    if (!matched) return result(node);
    if ('kind' in matched && matched.kind === 'limit') {
      return result(node, false, [], [], Object.freeze({
        kind: 'limit', limit: 'rewriteBranches', used: matched.used, maximum: matched.maximum
      }));
    }
    const replacement = rule.replace({nodes: state.context.nodes, bindings: matched.bindings});
    if (!state.context.math.isNode(replacement)) {
      throw new TypeError(`Rewrite rule "${rule.id}" returned a non-node replacement`);
    }
    const same = this.#structure.equals(node, replacement, {parentheses: 'preserve'});
    if (same) return result(node, false, matched.requirements);
    if (rule.costDirection !== 'any') {
      const compared = this.#structure.compareCost(replacement, node);
      if (compared > 0 || (rule.costDirection === 'decrease' && compared === 0)) return result(node);
    }
    const stateLimit = this.#register(replacement, state);
    const trace: RewriteStep = Object.freeze({
      rule: rule.id,
      before: this.#structure.fingerprint(node, {parentheses: 'preserve'}),
      after: this.#structure.fingerprint(replacement, {parentheses: 'preserve'}),
      requirements: matched.requirements
    });
    return result(replacement, true, matched.requirements, [trace], stateLimit ?? undefined);
  }

  #sequence(node: MathNode, strategies: readonly RewriteStrategy[], state: WorkState): InternalResult {
    let current = result(node);
    for (const strategy of strategies) {
      const next = this.#apply(current.node, strategy, state);
      current = result(
        next.node,
        current.changed || next.changed,
        mergeRequirements(current.requirements, next.requirements),
        [...current.trace, ...next.trace],
        next.limit
      );
      if (next.limit) break;
    }
    return current;
  }

  #choice(node: MathNode, strategies: readonly RewriteStrategy[], state: WorkState): InternalResult {
    for (const strategy of strategies) {
      const branchLimit = this.#chargeBranch(state);
      if (branchLimit) return result(node, false, [], [], branchLimit);
      const candidate = this.#apply(node, strategy, state);
      if (candidate.limit || candidate.changed) return candidate;
    }
    return result(node);
  }

  #repeat(node: MathNode, strategy: RewriteStrategy, state: WorkState): InternalResult {
    let current = result(node);
    while (true) {
      const next = this.#apply(current.node, strategy, state);
      if (next.limit) {
        return result(current.node, current.changed, mergeRequirements(current.requirements, next.requirements), [...current.trace, ...next.trace], next.limit);
      }
      if (!next.changed) return current;
      const fingerprint = this.#structure.fingerprint(next.node, {parentheses: 'preserve'});
      if (this.#structure.equals(next.node, current.node, {parentheses: 'preserve'}) || current.trace.some((step) => step.before === fingerprint)) {
        return current;
      }
      current = result(next.node, true, mergeRequirements(current.requirements, next.requirements), [...current.trace, ...next.trace]);
    }
  }

  #best(node: MathNode, strategies: readonly RewriteStrategy[], state: WorkState, branchMode: boolean): InternalResult {
    const candidates: InternalResult[] = [];
    for (const strategy of strategies) {
      const branchLimit = this.#chargeBranch(state);
      if (branchLimit) return result(node, false, [], [], branchLimit);
      const candidate = this.#apply(node, strategy, state);
      if (candidate.limit) return candidate;
      if (candidate.changed) candidates.push(candidate);
    }
    if (candidates.length === 0) return result(node);
    if (branchMode && candidates.length > state.limits.frontier) {
      return result(node, false, [], [], Object.freeze({kind: 'limit', limit: 'rewriteFrontier', used: candidates.length, maximum: state.limits.frontier}));
    }
    candidates.sort((left, right) => this.#structure.compareCost(left.node, right.node));
    return candidates[0]!;
  }

  #bestFirst(node: MathNode, strategies: readonly RewriteStrategy[], state: WorkState): InternalResult {
    let current = result(node);
    while (true) {
      const next = this.#best(current.node, strategies, state, true);
      if (next.limit) return result(current.node, current.changed, current.requirements, current.trace, next.limit);
      if (!next.changed || this.#structure.compareCost(next.node, current.node) >= 0) return current;
      current = result(next.node, true, mergeRequirements(current.requirements, next.requirements), [...current.trace, ...next.trace]);
    }
  }

  #traverse(node: MathNode, nested: RewriteStrategy, state: WorkState, topDown: boolean): InternalResult {
    let current = result(node);
    if (topDown) {
      current = this.#apply(node, nested, state);
      if (current.limit) return current;
    }
    let childLimit: RewriteLimit | undefined;
    let requirements = [...current.requirements];
    let trace = [...current.trace];
    let childChanged = false;
    const mapped = current.node.map((child) => {
      if (childLimit) return child;
      const transformed = this.#traverse(child, nested, state, topDown);
      if (transformed.limit) childLimit = transformed.limit;
      childChanged ||= transformed.changed;
      requirements = [...mergeRequirements(requirements, transformed.requirements)];
      trace.push(...transformed.trace);
      return transformed.node;
    });
    current = result(mapped, current.changed || childChanged, requirements, trace, childLimit);
    if (childLimit || topDown) return current;
    const after = this.#apply(current.node, nested, state);
    return result(after.node, current.changed || after.changed, mergeRequirements(current.requirements, after.requirements), [...current.trace, ...after.trace], after.limit);
  }
}
