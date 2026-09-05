import {
  isFunctionNode,
  isOperatorNode,
  isSymbolNode
} from 'mathjs';
import type {MathNode} from 'mathjs';
import {DefinednessAnalyzer} from '../core/definedness.js';
import {MathAdapter} from '../core/math-adapter.js';
import type {
  OperationContext,
  OperationLimitExceeded
} from '../core/operation-context.js';
import {StructuralEngine} from '../core/structure.js';
import {discoverFreeSymbols} from '../core/free-symbols.js';
import {
  algebraLimit,
  normalizeAlgebraLimits
} from './internal.js';
import type {
  ExpressionAnalysis,
  ExpressionAnalysisOptions,
  ExpressionAnalysisResult,
  ExpressionInventoryEntry,
  SafeEvaluationResult
} from './types.js';

function validateSymbolNames(symbols: readonly string[] = []): readonly string[] {
  if (!Array.isArray(symbols)) {
    throw new TypeError('Selected symbols must be an array');
  }
  const result = new Set<string>();
  for (const symbol of symbols) {
    if (typeof symbol !== 'string' || symbol.trim() === '') {
      throw new TypeError('Selected symbols must be nonempty strings');
    }
    result.add(symbol);
  }
  return Object.freeze([...result].sort());
}

function inventory(
  values: ReadonlyMap<string, number>
): readonly ExpressionInventoryEntry[] {
  return Object.freeze([...values.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]) => Object.freeze({name, count})));
}

/** Shared syntax, dependency, inventory, definedness, and evaluation analysis. */
export class ExpressionAnalyzer {
  readonly #math: MathAdapter;
  readonly #definedness: DefinednessAnalyzer;
  readonly #structure: StructuralEngine;

  constructor(
    math: MathAdapter,
    definedness: DefinednessAnalyzer,
    structure: StructuralEngine
  ) {
    this.#math = math;
    this.#definedness = definedness;
    this.#structure = structure;
    Object.freeze(this);
  }

  freeSymbols(node: MathNode): readonly string[] {
    this.#assertNode(node);
    return discoverFreeSymbols(node, (name) => this.#math.has(name));
  }

  safeEvaluate(
    node: MathNode,
    context: OperationContext
  ): SafeEvaluationResult {
    this.#assertNode(node);
    const freeSymbols = this.freeSymbols(node);
    const unresolved = freeSymbols.filter((name) =>
      !Object.prototype.hasOwnProperty.call(context.scope, name)
    );
    if (unresolved.length > 0) {
      return Object.freeze({
        kind: 'unevaluated',
        reason: 'free-symbols',
        freeSymbols: Object.freeze(unresolved)
      });
    }
    try {
      return Object.freeze({
        kind: 'value',
        value: node.compile().evaluate(context.scope)
      });
    } catch {
      return Object.freeze({
        kind: 'unevaluated',
        reason: 'evaluation-error',
        freeSymbols: Object.freeze([])
      });
    }
  }

  analyze(
    root: MathNode,
    context: OperationContext,
    options: ExpressionAnalysisOptions = {}
  ): ExpressionAnalysisResult {
    this.#assertNode(root);
    const limits = normalizeAlgebraLimits(options.algebraLimits);
    const selectedSymbols = validateSymbolNames(options.symbols);
    const atoms = options.atoms ?? [];
    if (!Array.isArray(atoms) || atoms.some((atom) => !this.#math.isNode(atom))) {
      throw new TypeError('Selected atoms must be MathJS nodes');
    }
    const atomKeys = atoms.map((atom) => this.#structure.key(atom, {
      parentheses: 'transparent'
    }));
    const atomCounts = atoms.map(() => 0);
    const symbolCounts = new Map<string, number>();
    const operators = new Map<string, number>();
    const functions = new Map<string, number>();
    const active = new WeakSet<object>();
    let nodeCount = 0;
    let maximumDepth = 0;

    const visit = (node: MathNode, depth: number): OperationLimitExceeded | null => {
      if (active.has(node as object)) {
        throw new TypeError('Cyclic MathJS node encountered during algebra analysis');
      }
      if (depth > limits.maximumDepth) {
        return algebraLimit('algebraDepth', depth, limits.maximumDepth);
      }
      active.add(node as object);
      try {
        nodeCount += 1;
        if (nodeCount > limits.maximumNodes) {
          return algebraLimit('algebraNodes', nodeCount, limits.maximumNodes);
        }
        maximumDepth = Math.max(maximumDepth, depth);

        const key = this.#structure.key(node, {parentheses: 'transparent'});
        for (let index = 0; index < atomKeys.length; index += 1) {
          if (key === atomKeys[index]) {
            atomCounts[index] = (atomCounts[index] ?? 0) + 1;
          }
        }

        if (isSymbolNode(node) && !this.#math.has(node.name)) {
          symbolCounts.set(node.name, (symbolCounts.get(node.name) ?? 0) + 1);
        }
        if (isOperatorNode(node)) {
          operators.set(node.fn, (operators.get(node.fn) ?? 0) + 1);
        }
        if (isFunctionNode(node)) {
          const functionExpression = node.fn as MathNode;
          const name = isSymbolNode(functionExpression)
            ? functionExpression.name
            : functionExpression.toString({parenthesis: 'all'});
          functions.set(name, (functions.get(name) ?? 0) + 1);
        }

        let exceeded: OperationLimitExceeded | null = null;
        node.forEach((child, path) => {
          if (exceeded) {
            return;
          }
          if (isFunctionNode(node) && path === 'fn' && isSymbolNode(child)) {
            return;
          }
          exceeded = visit(child, depth + 1);
        });
        return exceeded;
      } finally {
        active.delete(node as object);
      }
    };

    const exceeded = visit(root, 1);
    if (exceeded) {
      return exceeded;
    }

    const freeSymbols = this.freeSymbols(root);
    const selectedSymbolOccurrences = selectedSymbols.reduce(
      (sum, symbol) => sum + (symbolCounts.get(symbol) ?? 0),
      0
    );
    const selectedAtomOccurrences = atomCounts.reduce((sum, count) => sum + count, 0);
    const dependsOnSelection = selectedSymbolOccurrences + selectedAtomOccurrences > 0;
    const analysis: ExpressionAnalysis = {
      kind: 'analysis',
      expression: root,
      freeSymbols,
      symbolOccurrences: Object.freeze(Object.fromEntries(
        [...symbolCounts.entries()].sort(([left], [right]) => left.localeCompare(right))
      )),
      atomOccurrences: Object.freeze(atoms.map((atom, index) => Object.freeze({
        atom,
        count: atomCounts[index] ?? 0
      }))),
      dependsOnSelection,
      targetFree: !dependsOnSelection,
      constant: freeSymbols.length === 0,
      operators: inventory(operators),
      functions: inventory(functions),
      definedness: this.#definedness.requirements(root, {
        domain: context.domain,
        includeLeafDefinedness: options.includeLeafDefinedness ?? false
      }),
      evaluation: this.safeEvaluate(root, context),
      nodeCount,
      maximumDepth
    };
    return Object.freeze(analysis);
  }

  dependsOn(
    node: MathNode,
    symbols: readonly string[],
    atoms: readonly MathNode[] = []
  ): boolean {
    this.#assertNode(node);
    const selectedSymbols = new Set(validateSymbolNames(symbols));
    const atomKeys = atoms.map((atom) => {
      this.#assertNode(atom);
      return this.#structure.key(atom, {parentheses: 'transparent'});
    });
    let found = false;
    node.traverse((candidate, path, parent) => {
      if (found) {
        return;
      }
      if (
        isSymbolNode(candidate) &&
        !(parent && isFunctionNode(parent) && path === 'fn') &&
        selectedSymbols.has(candidate.name)
      ) {
        found = true;
        return;
      }
      if (parent && isFunctionNode(parent) && path === 'fn') {
        return;
      }
      const key = this.#structure.key(candidate, {parentheses: 'transparent'});
      if (atomKeys.includes(key)) {
        found = true;
      }
    });
    return found;
  }

  occurrenceCount(
    node: MathNode,
    symbols: readonly string[],
    atoms: readonly MathNode[] = []
  ): number {
    this.#assertNode(node);
    const selectedSymbols = new Set(validateSymbolNames(symbols));
    const atomKeys = atoms.map((atom) => {
      this.#assertNode(atom);
      return this.#structure.key(atom, {parentheses: 'transparent'});
    });
    let count = 0;
    node.traverse((candidate, path, parent) => {
      const matchesSymbol =
        isSymbolNode(candidate) &&
        !(parent && isFunctionNode(parent) && path === 'fn') &&
        selectedSymbols.has(candidate.name);
      if (parent && isFunctionNode(parent) && path === 'fn') {
        return;
      }
      const key = this.#structure.key(candidate, {parentheses: 'transparent'});
      if (matchesSymbol || atomKeys.includes(key)) {
        count += 1;
      }
    });
    return count;
  }

  #assertNode(node: MathNode): void {
    if (!this.#math.isNode(node)) {
      throw new TypeError('MathJS node expected for algebra analysis');
    }
  }
}
