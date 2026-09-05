import {
  isFunctionNode,
  isOperatorNode,
  isParenthesisNode,
  isSymbolNode
} from 'mathjs';
import type {MathNode} from 'mathjs';
import {AlgebraEngine} from '../algebra/engine.js';
import type {OperationContext} from './operation-context.js';
import type {SymbolicPredicate} from './predicate.js';
import {predicateKey} from './predicate.js';
import type {
  CapturePattern,
  MatchBindings,
  MatchResult,
  Pattern,
  PatternGuard
} from './pattern.js';
import {PredicateEngine} from './semantic-engine.js';
import {StructuralEngine} from './structure.js';

export interface MatchLimit {
  readonly kind: 'limit';
  readonly limit: 'matchBranches';
  readonly used: number;
  readonly maximum: number;
}

export type PatternMatchResult = MatchResult | MatchLimit | null;

type InternalMatchResult = MutableBindings | MatchLimit | null;

interface MutableBindings {
  captures: Record<string, MathNode>;
  rest: Record<string, readonly MathNode[]>;
  requirements: Map<string, SymbolicPredicate>;
}

function isLimit(value: InternalMatchResult): value is MatchLimit {
  return value !== null && 'kind' in value && value.kind === 'limit';
}

function cloneBindings(source: MutableBindings): MutableBindings {
  return {
    captures: {...source.captures},
    rest: {...source.rest},
    requirements: new Map(source.requirements)
  };
}

function freezeResult(bindings: MutableBindings): MatchResult {
  return Object.freeze({
    kind: 'match',
    bindings: Object.freeze({
      captures: Object.freeze({...bindings.captures}),
      rest: Object.freeze(Object.fromEntries(
        Object.entries(bindings.rest).map(([name, values]) => [name, Object.freeze([...values])])
      ))
    } satisfies MatchBindings),
    requirements: Object.freeze([...bindings.requirements.values()])
  });
}

/** Deterministic typed structural matcher with bounded AC backtracking. */
export class PatternMatcher {
  readonly #structure: StructuralEngine;
  readonly #semantics: PredicateEngine;
  readonly #algebra: AlgebraEngine;

  constructor(
    structure: StructuralEngine,
    semantics: PredicateEngine,
    algebra: AlgebraEngine
  ) {
    this.#structure = structure;
    this.#semantics = semantics;
    this.#algebra = algebra;
    Object.freeze(this);
  }

  match(
    node: MathNode,
    pattern: Pattern,
    context: OperationContext
  ): PatternMatchResult {
    const initial: MutableBindings = {
      captures: {},
      rest: {},
      requirements: new Map()
    };
    const matched = this.#matchNode(node, pattern, context, initial);
    if (!matched || isLimit(matched)) return matched;
    return freezeResult(matched);
  }

  #matchNode(
    rawNode: MathNode,
    pattern: Pattern,
    context: OperationContext,
    bindings: MutableBindings
  ): InternalMatchResult {
    const node = isParenthesisNode(rawNode) ? rawNode.content : rawNode;
    switch (pattern.kind) {
      case 'literal':
        return this.#structure.equals(node, pattern.node, {parentheses: 'transparent'})
          ? bindings
          : null;
      case 'capture':
        return this.#capture(node, pattern, context, bindings);
      case 'same': {
        const existing = bindings.captures[pattern.name];
        return existing && this.#structure.equals(node, existing, {parentheses: 'transparent'})
          ? bindings
          : null;
      }
      case 'alternative':
        for (const choice of pattern.patterns) {
          const candidate = this.#matchNode(node, choice, context, cloneBindings(bindings));
          if (candidate) return candidate;
        }
        return null;
      case 'optional':
        return this.#matchNode(node, pattern.pattern, context, cloneBindings(bindings)) ?? bindings;
      case 'rest':
        bindings.rest[pattern.name] = Object.freeze([node]);
        return bindings;
      case 'function':
        if (
          !isFunctionNode(node) ||
          !isSymbolNode(node.fn) ||
          node.fn.name !== pattern.name
        ) return null;
        return this.#matchOrdered(node.args, pattern.args, context, bindings);
      case 'operator': {
        if (!isOperatorNode(node) || node.op !== pattern.op) return null;
        const actual = pattern.associative
          ? this.#flatten(node, pattern.op)
          : [...node.args];
        if (pattern.commutative) {
          const sorted = [...actual].sort((left, right) => this.#structure.compare(left, right));
          return this.#matchCommutative(sorted, pattern.args, context, bindings);
        }
        return this.#matchOrdered(actual, pattern.args, context, bindings);
      }
    }
  }

  #capture(
    node: MathNode,
    pattern: CapturePattern,
    context: OperationContext,
    bindings: MutableBindings
  ): InternalMatchResult {
    const existing = bindings.captures[pattern.name];
    if (existing) {
      return this.#structure.equals(existing, node, {parentheses: 'transparent'})
        ? bindings
        : null;
    }
    if (pattern.guard && !this.#guard(node, pattern.guard, context, bindings)) return null;
    bindings.captures[pattern.name] = node;
    return bindings;
  }

  #guard(
    node: MathNode,
    guard: PatternGuard,
    context: OperationContext,
    bindings: MutableBindings
  ): boolean {
    if (guard.kind === 'free-of') return !this.#algebra.dependsOn(node, guard.symbols);
    if (guard.kind === 'depends-on') return this.#algebra.dependsOn(node, guard.symbols);
    if (guard.kind === 'affine-in') {
      return this.#algebra.affine(node, {
        generator: guard.generator,
        domain: context.domain,
        assumptions: context.assumptions,
        scope: context.scope,
        mode: context.mode
      }).kind === 'view';
    }
    if (guard.kind === 'polynomial-in') {
      return this.#algebra.polynomial(node, {
        generators: guard.generators,
        domain: context.domain,
        assumptions: context.assumptions,
        scope: context.scope,
        mode: context.mode
      }).kind === 'view';
    }
    if (guard.kind === 'rational-in') {
      return this.#algebra.rational(node, {
        generators: guard.generators,
        domain: context.domain,
        assumptions: context.assumptions,
        scope: context.scope,
        mode: context.mode
      }).kind === 'view';
    }
    const judgment = this.#semantics.ask(guard.predicate, context);
    if (judgment.truth === 'proven') return true;
    if (judgment.truth === 'disproven' || context.mode === 'strict') return false;
    for (const requirement of judgment.requirements) {
      bindings.requirements.set(predicateKey(requirement), requirement);
    }
    return true;
  }

  #matchOrdered(
    nodes: readonly MathNode[],
    patterns: readonly Pattern[],
    context: OperationContext,
    bindings: MutableBindings
  ): InternalMatchResult {
    const restIndex = patterns.findIndex((value) => value.kind === 'rest');
    const optionalCount = patterns.filter((value) => value.kind === 'optional').length;
    const required = patterns.length - optionalCount - (restIndex >= 0 ? 1 : 0);
    if (nodes.length < required || (restIndex < 0 && nodes.length > patterns.length)) return null;
    let current = bindings;
    let nodeIndex = 0;
    for (const currentPattern of patterns) {
      if (currentPattern.kind === 'rest') {
        current.rest[currentPattern.name] = Object.freeze(nodes.slice(nodeIndex));
        nodeIndex = nodes.length;
        continue;
      }
      if (currentPattern.kind === 'optional') {
        if (nodeIndex >= nodes.length) continue;
        const trial = this.#matchNode(nodes[nodeIndex]!, currentPattern.pattern, context, cloneBindings(current));
        if (isLimit(trial)) return trial;
        if (trial) {
          current = trial;
          nodeIndex += 1;
        }
        continue;
      }
      if (nodeIndex >= nodes.length) return null;
      const matched = this.#matchNode(nodes[nodeIndex]!, currentPattern, context, current);
      if (!matched || isLimit(matched)) return matched;
      current = matched;
      nodeIndex += 1;
    }
    return nodeIndex === nodes.length ? current : null;
  }

  #matchCommutative(
    nodes: readonly MathNode[],
    patterns: readonly Pattern[],
    context: OperationContext,
    bindings: MutableBindings
  ): InternalMatchResult {
    const rest = patterns.find((value) => value.kind === 'rest');
    const requiredPatterns = patterns.filter((value) => value.kind !== 'rest' && value.kind !== 'optional');
    const optionalPatterns = patterns.filter((value) => value.kind === 'optional');
    const attempt = (
      patternIndex: number,
      remaining: readonly MathNode[],
      current: MutableBindings
    ): InternalMatchResult => {
      if (patternIndex >= requiredPatterns.length) {
        let result = current;
        const leftovers = [...remaining];
        for (const optionalPattern of optionalPatterns) {
          for (let index = 0; index < leftovers.length; index += 1) {
            const limit = context.consume('matchBranches');
            if (limit) return Object.freeze({kind: 'limit', limit: 'matchBranches', used: limit.used, maximum: limit.maximum});
            const matched = this.#matchNode(leftovers[index]!, optionalPattern.pattern, context, cloneBindings(result));
            if (isLimit(matched)) return matched;
            if (matched) {
              result = matched;
              leftovers.splice(index, 1);
              break;
            }
          }
        }
        if (rest) result.rest[rest.name] = Object.freeze(leftovers);
        return rest || leftovers.length === 0 ? result : null;
      }
      const currentPattern = requiredPatterns[patternIndex]!;
      for (let index = 0; index < remaining.length; index += 1) {
        const limit = context.consume('matchBranches');
        if (limit) return Object.freeze({kind: 'limit', limit: 'matchBranches', used: limit.used, maximum: limit.maximum});
        const matched = this.#matchNode(remaining[index]!, currentPattern, context, cloneBindings(current));
        if (isLimit(matched)) return matched;
        if (!matched) continue;
        const next = remaining.filter((_, candidate) => candidate !== index);
        const completed = attempt(patternIndex + 1, next, matched);
        if (completed) return completed;
      }
      return null;
    };
    return attempt(0, nodes, bindings);
  }

  #flatten(node: MathNode, op: string): readonly MathNode[] {
    if (!isOperatorNode(node) || node.op !== op) return [node];
    const result: MathNode[] = [];
    for (const arg of node.args) {
      if (isOperatorNode(arg) && arg.op === op) result.push(...this.#flatten(arg, op));
      else result.push(arg);
    }
    return result;
  }
}
