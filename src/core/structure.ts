import {
  isConstantNode,
  isFunctionNode,
  isOperatorNode,
  isParenthesisNode,
  isSymbolNode
} from 'mathjs';
import type {MathNode} from 'mathjs';
import {MathAdapter} from './math-adapter.js';
import type {OperationContext} from './operation-context.js';
import type {ParenthesisPolicy, StructuralKeyOptions} from './structural-key.js';
import {
  structuralFingerprintFromKey,
  structuralKey,
  structuralTypeRank
} from './structural-key.js';

export interface ExpressionCostWeights {
  readonly node: number;
  readonly depth: number;
  readonly operator: number;
  readonly function: number;
  readonly division: number;
  readonly power: number;
  readonly targetOccurrence: number;
}

export interface ExpressionCostOptions extends StructuralKeyOptions {
  readonly target?: string;
  readonly weights?: Partial<ExpressionCostWeights>;
  readonly maximumNodes?: number;
  readonly maximumDepth?: number;
}

export interface ExpressionMetrics {
  readonly nodeCount: number;
  readonly leafCount: number;
  readonly maximumDepth: number;
  readonly constantCount: number;
  readonly symbolCount: number;
  readonly distinctSymbols: readonly string[];
  readonly targetOccurrences: number;
  readonly operatorCount: number;
  readonly functionCount: number;
  readonly divisionCount: number;
  readonly powerCount: number;
  readonly maximumFunctionDepth: number;
  readonly maximumArity: number;
}

export interface ExpressionCost {
  readonly score: number;
  readonly metrics: ExpressionMetrics;
  readonly weights: ExpressionCostWeights;
}

export interface StructuralAnalysis {
  readonly key: string;
  readonly fingerprint: string;
  readonly typeRank: number;
  readonly cost: ExpressionCost;
}

export const DEFAULT_EXPRESSION_COST_WEIGHTS: ExpressionCostWeights = Object.freeze({
  node: 1,
  depth: 2,
  operator: 1,
  function: 3,
  division: 2,
  power: 2,
  targetOccurrence: 1
});

function finiteNonnegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and nonnegative`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function normalizeWeights(
  supplied: Partial<ExpressionCostWeights> = {}
): ExpressionCostWeights {
  const weights = {...DEFAULT_EXPRESSION_COST_WEIGHTS, ...supplied};
  for (const [name, value] of Object.entries(weights)) {
    finiteNonnegative(value, `Expression cost weight "${name}"`);
  }
  return Object.freeze(weights);
}

function normalizeOptions(
  options: ExpressionCostOptions = {}
): Required<Omit<ExpressionCostOptions, 'target' | 'weights'>> & {
  readonly target?: string;
  readonly weights: ExpressionCostWeights;
} {
  const parentheses = options.parentheses ?? 'transparent';
  if (parentheses !== 'preserve' && parentheses !== 'transparent') {
    throw new TypeError('Unknown structural parenthesis policy');
  }
  if (options.target !== undefined && (
    typeof options.target !== 'string' || options.target.trim() === ''
  )) {
    throw new TypeError('Expression cost target must be a nonempty string');
  }
  return {
    parentheses,
    ...(options.target === undefined ? {} : {target: options.target}),
    weights: normalizeWeights(options.weights),
    maximumNodes: positiveInteger(options.maximumNodes ?? 100_000, 'maximumNodes'),
    maximumDepth: positiveInteger(options.maximumDepth ?? 1_000, 'maximumDepth')
  };
}

function memoKey(options: ReturnType<typeof normalizeOptions>): string {
  return [
    options.parentheses,
    options.target ?? '',
    options.maximumNodes,
    options.maximumDepth,
    ...Object.entries(options.weights)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([name, value]) => [name, value])
  ].join('|');
}

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Structural identity, deterministic ordering, and syntax-cost analysis. */
export class StructuralEngine {
  readonly #math: MathAdapter;

  constructor(math: MathAdapter) {
    this.#math = math;
    Object.freeze(this);
  }

  key(node: MathNode, options: StructuralKeyOptions = {}): string {
    this.#assertNode(node);
    return structuralKey(node, options);
  }

  fingerprint(node: MathNode, options: StructuralKeyOptions = {}): string {
    return structuralFingerprintFromKey(this.key(node, options));
  }

  equals(
    left: MathNode,
    right: MathNode,
    options: StructuralKeyOptions = {}
  ): boolean {
    this.#assertNode(left);
    this.#assertNode(right);
    return left === right || this.key(left, options) === this.key(right, options);
  }

  compare(
    left: MathNode,
    right: MathNode,
    options: StructuralKeyOptions = {}
  ): number {
    this.#assertNode(left);
    this.#assertNode(right);
    if (left === right) {
      return 0;
    }
    const leftKey = this.key(left, options);
    const rightKey = this.key(right, options);
    if (leftKey === rightKey) {
      return 0;
    }
    const type = compareNumbers(structuralTypeRank(left), structuralTypeRank(right));
    return type !== 0 ? type : leftKey.localeCompare(rightKey);
  }

  sort(
    nodes: readonly MathNode[],
    options: StructuralKeyOptions = {}
  ): readonly MathNode[] {
    if (!Array.isArray(nodes) || nodes.some((node) => !this.#math.isNode(node))) {
      throw new TypeError('MathJS nodes expected for structural sorting');
    }
    return Object.freeze([...nodes].sort((left, right) =>
      this.compare(left, right, options)
    ));
  }

  cost(
    node: MathNode,
    options: ExpressionCostOptions = {},
    context?: OperationContext
  ): ExpressionCost {
    return this.analyze(node, options, context).cost;
  }

  analyze(
    node: MathNode,
    options: ExpressionCostOptions = {},
    context?: OperationContext
  ): StructuralAnalysis {
    this.#assertNode(node);
    const normalized = normalizeOptions(options);
    const create = () => this.#analyze(node, normalized);
    return context
      ? context.memoize(node, `structure:${memoKey(normalized)}`, create)
      : create();
  }

  compareCost(
    left: MathNode,
    right: MathNode,
    options: ExpressionCostOptions = {},
    context?: OperationContext
  ): number {
    const leftAnalysis = this.analyze(left, options, context);
    const rightAnalysis = this.analyze(right, options, context);
    const leftMetrics = leftAnalysis.cost.metrics;
    const rightMetrics = rightAnalysis.cost.metrics;
    const dimensions: readonly [number, number][] = [
      [leftAnalysis.cost.score, rightAnalysis.cost.score],
      [leftMetrics.nodeCount, rightMetrics.nodeCount],
      [leftMetrics.maximumDepth, rightMetrics.maximumDepth],
      [leftMetrics.functionCount, rightMetrics.functionCount],
      [leftMetrics.operatorCount, rightMetrics.operatorCount],
      [leftMetrics.targetOccurrences, rightMetrics.targetOccurrences]
    ];
    for (const [leftValue, rightValue] of dimensions) {
      const compared = compareNumbers(leftValue, rightValue);
      if (compared !== 0) {
        return compared;
      }
    }
    return leftAnalysis.key.localeCompare(rightAnalysis.key);
  }

  #analyze(
    root: MathNode,
    options: ReturnType<typeof normalizeOptions>
  ): StructuralAnalysis {
    let nodeCount = 0;
    let leafCount = 0;
    let maximumDepth = 0;
    let constantCount = 0;
    let symbolCount = 0;
    let targetOccurrences = 0;
    let operatorCount = 0;
    let functionCount = 0;
    let divisionCount = 0;
    let powerCount = 0;
    let maximumFunctionDepth = 0;
    let maximumArity = 0;
    const distinctSymbols = new Set<string>();
    const active = new WeakSet<object>();

    const visit = (raw: MathNode, depth: number, functionDepth: number): void => {
      const node = options.parentheses === 'transparent' && isParenthesisNode(raw)
        ? raw.content
        : raw;
      if (active.has(node)) {
        throw new TypeError('Cyclic MathJS node encountered during structural analysis');
      }
      if (depth > options.maximumDepth) {
        throw new RangeError('Structural analysis exceeded maximumDepth');
      }
      active.add(node);
      try {
        nodeCount += 1;
        if (nodeCount > options.maximumNodes) {
          throw new RangeError('Structural analysis exceeded maximumNodes');
        }
        maximumDepth = Math.max(maximumDepth, depth);

        if (isConstantNode(node)) {
          constantCount += 1;
        }
        if (isSymbolNode(node)) {
          symbolCount += 1;
          distinctSymbols.add(node.name);
          if (node.name === options.target) {
            targetOccurrences += 1;
          }
        }
        if (isOperatorNode(node)) {
          operatorCount += 1;
          if (node.fn === 'divide') {
            divisionCount += 1;
          } else if (node.fn === 'pow') {
            powerCount += 1;
          }
        }
        const nextFunctionDepth = isFunctionNode(node)
          ? functionDepth + 1
          : functionDepth;
        if (isFunctionNode(node)) {
          functionCount += 1;
          maximumFunctionDepth = Math.max(
            maximumFunctionDepth,
            nextFunctionDepth
          );
        }

        const children: MathNode[] = [];
        node.forEach((child, path) => {
          if (isFunctionNode(node) && path === 'fn' && isSymbolNode(child)) {
            return;
          }
          children.push(child);
        });
        maximumArity = Math.max(maximumArity, children.length);
        if (children.length === 0) {
          leafCount += 1;
        }
        for (const child of children) {
          visit(child, depth + 1, nextFunctionDepth);
        }
      } finally {
        active.delete(node);
      }
    };

    visit(root, 1, 0);
    const metrics: ExpressionMetrics = Object.freeze({
      nodeCount,
      leafCount,
      maximumDepth,
      constantCount,
      symbolCount,
      distinctSymbols: Object.freeze([...distinctSymbols].sort()),
      targetOccurrences,
      operatorCount,
      functionCount,
      divisionCount,
      powerCount,
      maximumFunctionDepth,
      maximumArity
    });
    const score =
      nodeCount * options.weights.node +
      maximumDepth * options.weights.depth +
      operatorCount * options.weights.operator +
      functionCount * options.weights.function +
      divisionCount * options.weights.division +
      powerCount * options.weights.power +
      targetOccurrences * options.weights.targetOccurrence;
    const cost: ExpressionCost = Object.freeze({
      score,
      metrics,
      weights: options.weights
    });
    const key = structuralKey(root, {parentheses: options.parentheses});
    return Object.freeze({
      key,
      fingerprint: structuralFingerprintFromKey(key),
      typeRank: structuralTypeRank(
        options.parentheses === 'transparent' && isParenthesisNode(root)
          ? root.content
          : root
      ),
      cost
    });
  }

  #assertNode(node: MathNode): void {
    if (!this.#math.isNode(node)) {
      throw new TypeError('MathJS node expected for structural analysis');
    }
  }
}
