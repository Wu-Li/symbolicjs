import {
  isConstantNode,
  isFunctionNode,
  isOperatorNode,
  isSymbolNode
} from 'mathjs';
import type {MathJsInstance, MathNode} from 'mathjs';
import {nodeSymbols} from './analysis.js';
import {SolverContext} from './budget.js';
import {customFactory} from './custom-factory.js';
import type {SymbolicKernel} from './kernel.js';
import {limitResult, parametricResult, unsupportedResult} from './solve-types.js';
import type {
  Condition,
  LimitResult,
  ParametricFamily,
  ParametricSolutions,
  PartialResult,
  Solution,
  SolveOptions,
  SolveResult,
  UnsupportedResult
} from './solve-types.js';
import type {EqualityNode, EqualityNodeConstructor} from './types.js';

interface CompoundDependencies {
  ConstantNode: MathJsInstance['ConstantNode'];
  EqualityNode: EqualityNodeConstructor;
  FunctionNode: MathJsInstance['FunctionNode'];
  OperatorNode: MathJsInstance['OperatorNode'];
  SymbolNode: MathJsInstance['SymbolNode'];
  canonicalizeParametricFamilies(
    families: readonly ParametricFamily[],
    usedSymbols?: readonly string[]
  ): readonly ParametricFamily[];
  polynomialSolve(
    equation: EqualityNode,
    target: string,
    options?: SolveOptions,
    maximumDegree?: number
  ): SolveResult;
  trigonometricSolve(
    equation: EqualityNode,
    target: string,
    options?: SolveOptions
  ): SolveResult;
  symbolicKernel: SymbolicKernel;
}

interface NormalizedEquation {
  readonly equation: EqualityNode;
  readonly changed: boolean;
}

function isSolutions(value: readonly Solution[] | LimitResult | null): value is readonly Solution[] {
  return Array.isArray(value);
}

export class CompoundTrigonometricEngine {
  readonly #dependencies: CompoundDependencies;

  constructor(dependencies: CompoundDependencies) {
    this.#dependencies = dependencies;
  }

  #constant(value: number): MathNode {
    return new this.#dependencies.ConstantNode(value);
  }

  #symbol(name: string): MathNode {
    return new this.#dependencies.SymbolNode(name);
  }

  #operator(op: string, fn: string, args: MathNode[]): MathNode {
    return new this.#dependencies.OperatorNode(op as never, fn as never, args);
  }

  #add(left: MathNode, right: MathNode): MathNode {
    return this.#operator('+', 'add', [left, right]);
  }

  #subtract(left: MathNode, right: MathNode): MathNode {
    return this.#operator('-', 'subtract', [left, right]);
  }

  #multiply(left: MathNode, right: MathNode): MathNode {
    return this.#operator('*', 'multiply', [left, right]);
  }

  #divide(left: MathNode, right: MathNode): MathNode {
    return this.#operator('/', 'divide', [left, right]);
  }

  #negate(value: MathNode): MathNode {
    return this.#operator('-', 'unaryMinus', [value]);
  }

  #pow(value: MathNode, exponent: number): MathNode {
    return this.#operator('^', 'pow', [value, this.#constant(exponent)]);
  }

  #function(name: string, argument: MathNode): MathNode {
    return new this.#dependencies.FunctionNode(this.#symbol(name), [argument]);
  }

  #functionParts(node: MathNode, name?: string): {name: string; argument: MathNode} | null {
    if (
      !isFunctionNode(node) ||
      !isSymbolNode(node.fn) ||
      node.args.length !== 1 ||
      (name !== undefined && node.fn.name !== name)
    ) {
      return null;
    }
    return {name: node.fn.name, argument: node.args[0]!};
  }

  #squaredFunction(node: MathNode, name: string): MathNode | null {
    if (!isOperatorNode(node) || node.op !== '^' || node.args.length !== 2) {
      return null;
    }
    const exponent = node.args[1]!;
    if (!isConstantNode(exponent) || Number(exponent.value) !== 2) {
      return null;
    }
    return this.#functionParts(node.args[0]!, name)?.argument ?? null;
  }

  #negatedValue(node: MathNode): MathNode | null {
    return isOperatorNode(node) &&
      node.op === '-' &&
      node.args.length === 1
      ? node.args[0]!
      : null;
  }

  #rewriteNode(node: MathNode): MathNode {
    if (isFunctionNode(node) && isSymbolNode(node.fn) && node.args.length === 1) {
      const argument = node.args[0]!;
      if (
        (node.fn.name === 'sin' || node.fn.name === 'cos' || node.fn.name === 'tan') &&
        isOperatorNode(argument) &&
        argument.op === '-' &&
        argument.args.length === 1
      ) {
        const positive = this.#function(node.fn.name, argument.args[0]!);
        return node.fn.name === 'cos' ? positive : this.#negate(positive);
      }
    }
    if (isOperatorNode(node) && node.op === '+' && node.args.length === 2) {
      const leftNegated = this.#negatedValue(node.args[0]!);
      const rightNegated = this.#negatedValue(node.args[1]!);
      if (
        (leftNegated && leftNegated.equals(node.args[1]!)) ||
        (rightNegated && rightNegated.equals(node.args[0]!))
      ) {
        return this.#constant(0);
      }
      const leftSin = this.#squaredFunction(node.args[0]!, 'sin');
      const rightCos = this.#squaredFunction(node.args[1]!, 'cos');
      const leftCos = this.#squaredFunction(node.args[0]!, 'cos');
      const rightSin = this.#squaredFunction(node.args[1]!, 'sin');
      if (
        (leftSin && rightCos && leftSin.equals(rightCos)) ||
        (leftCos && rightSin && leftCos.equals(rightSin))
      ) {
        return this.#constant(1);
      }
    }
    if (
      isOperatorNode(node) &&
      node.op === '-' &&
      node.args.length === 2 &&
      node.args[0]!.equals(node.args[1]!)
    ) {
      return this.#constant(0);
    }
    if (isOperatorNode(node) && node.op === '*' && node.args.length === 2) {
      const leftSin = this.#functionParts(node.args[0]!, 'sin');
      const rightCos = this.#functionParts(node.args[1]!, 'cos');
      const leftCos = this.#functionParts(node.args[0]!, 'cos');
      const rightSin = this.#functionParts(node.args[1]!, 'sin');
      const argument = leftSin && rightCos && leftSin.argument.equals(rightCos.argument)
        ? leftSin.argument
        : leftCos && rightSin && leftCos.argument.equals(rightSin.argument)
          ? leftCos.argument
          : null;
      if (argument) {
        return this.#multiply(
          this.#constant(0.5),
          this.#function('sin', this.#multiply(this.#constant(2), argument))
        );
      }
    }
    return node;
  }

  #normalize(
    equation: EqualityNode,
    target: string,
    context: SolverContext
  ): NormalizedEquation | LimitResult | UnsupportedResult {
    let current = equation;
    let changed = false;
    const visited = new Set<string>();
    while (true) {
      const key = `${current.lhs.toString({parenthesis: 'all'})}=:=${
        current.rhs.toString({parenthesis: 'all'})
      }`;
      if (visited.has(key)) {
        return unsupportedResult(target, 'unsupported-trig-form');
      }
      visited.add(key);
      let rewrites = 0;
      const transform = (root: MathNode) => root.transform<MathNode>((candidate) => {
        const rewritten = this.#rewriteNode(candidate);
        if (!rewritten.equals(candidate)) {
          rewrites += 1;
        }
        return rewritten;
      });
      const lhs = transform(current.lhs);
      const rhs = transform(current.rhs);
      if (rewrites === 0) {
        return {equation: current, changed};
      }
      const limit = context.consume('rewrite-steps', rewrites) ??
        context.consume('total-work', rewrites);
      if (limit) {
        return limit;
      }
      let nodes = 0;
      lhs.traverse(() => { nodes += 1; });
      rhs.traverse(() => { nodes += 1; });
      const sizeLimit = context.consume('symbolic-expression-nodes', nodes);
      if (sizeLimit) {
        return sizeLimit;
      }
      current = new this.#dependencies.EqualityNode(
        this.#dependencies.symbolicKernel.simplify(lhs),
        this.#dependencies.symbolicKernel.simplify(rhs)
      );
      changed = true;
    }
  }

  #targetTrigNodes(equation: EqualityNode, target: string): MathNode[] {
    const nodes: MathNode[] = [];
    for (const root of [equation.lhs, equation.rhs]) {
      root.traverse((candidate) => {
        const parts = this.#functionParts(candidate);
        if (
          parts &&
          (parts.name === 'sin' || parts.name === 'cos' || parts.name === 'tan') &&
          nodeSymbols(parts.argument).includes(target)
        ) {
          nodes.push(candidate);
        }
      });
    }
    return nodes;
  }

  #replaceEquivalent(root: MathNode, atom: MathNode, replacement: MathNode): MathNode {
    return root.transform<MathNode>((candidate) =>
      candidate.equals(atom) ? replacement : candidate
    );
  }

  #candidateValues(result: SolveResult): readonly Solution[] | LimitResult | null {
    if (result.kind === 'limit') {
      return result;
    }
    if (result.kind === 'finite' || result.kind === 'partial') {
      return result.solutions;
    }
    return null;
  }

  #mergeFamilies(
    target: string,
    equation: EqualityNode,
    entries: readonly {
      result: ParametricSolutions;
      conditions: readonly Condition[];
    }[],
    partial: boolean
  ): SolveResult {
    const families: ParametricFamily[] = [];
    for (const entry of entries) {
      for (const family of entry.result.families) {
        const normalized = this.#dependencies.symbolicKernel.normalizeConditions([
          ...entry.conditions,
          ...family.conditions
        ]);
        if (!normalized.contradictory) {
          families.push(Object.freeze({...family, conditions: normalized.conditions}));
        }
      }
    }
    const canonical = this.#dependencies.canonicalizeParametricFamilies(
      families,
      [...new Set([
        ...nodeSymbols(equation.lhs),
        ...nodeSymbols(equation.rhs),
        target
      ])]
    );
    if (canonical.length === 0) {
      return Object.freeze({kind: 'contradiction', target, conditions: Object.freeze([])});
    }
    if (partial) {
      return Object.freeze({
        kind: 'partial',
        target,
        solutions: Object.freeze([]),
        families: canonical,
        remainder: equation,
        reason: 'verification-inconclusive'
      }) as PartialResult;
    }
    return parametricResult(target, canonical);
  }

  #polynomialInOneAtom(
    equation: EqualityNode,
    target: string,
    nodes: readonly MathNode[],
    options?: SolveOptions
  ): SolveResult | null {
    const atom = nodes[0];
    if (!atom || !nodes.every((node) => node.equals(atom))) {
      return null;
    }
    let temporaryName = '__symbolicjs_trig_polynomial';
    const used = new Set([...nodeSymbols(equation.lhs), ...nodeSymbols(equation.rhs)]);
    while (used.has(temporaryName)) {
      temporaryName += '_';
    }
    const temporary = this.#symbol(temporaryName);
    const reduced = new this.#dependencies.EqualityNode(
      this.#replaceEquivalent(equation.lhs, atom, temporary),
      this.#replaceEquivalent(equation.rhs, atom, temporary)
    );
    if (
      nodeSymbols(reduced.lhs).includes(target) ||
      nodeSymbols(reduced.rhs).includes(target)
    ) {
      return null;
    }
    const auxiliary = this.#dependencies.polynomialSolve(reduced, temporaryName, options, 3);
    if (auxiliary.kind === 'limit') {
      return Object.freeze({...auxiliary, target});
    }
    const values = this.#candidateValues(auxiliary);
    if (!values || !isSolutions(values)) {
      return null;
    }
    const lifted: {result: ParametricSolutions; conditions: readonly Condition[]}[] = [];
    let unsupportedLift = false;
    for (const solution of values) {
      const direct = this.#dependencies.trigonometricSolve(
        new this.#dependencies.EqualityNode(atom, solution.value),
        target,
        options
      );
      if (direct.kind === 'limit') {
        return direct;
      }
      if (direct.kind === 'parametric') {
        lifted.push({result: direct, conditions: solution.conditions});
      } else if (direct.kind === 'unsupported') {
        unsupportedLift = true;
      }
    }
    if (unsupportedLift) {
      return null;
    }
    if (lifted.length === 0) {
      return Object.freeze({kind: 'contradiction', target, conditions: Object.freeze([])});
    }
    return this.#mergeFamilies(
      target,
      equation,
      lifted,
      auxiliary.kind === 'partial'
    );
  }

  #isZero(node: MathNode): boolean {
    return this.#dependencies.symbolicKernel.canonicalKey(node) === 'number:0';
  }

  #amplitudePhase(
    equation: EqualityNode,
    target: string,
    nodes: readonly MathNode[],
    context: SolverContext,
    options?: SolveOptions
  ): SolveResult | null {
    const sine = nodes.find((node) => this.#functionParts(node, 'sin'));
    const cosine = nodes.find((node) => this.#functionParts(node, 'cos'));
    if (!sine || !cosine) {
      return null;
    }
    const sineArgument = this.#functionParts(sine, 'sin')!.argument;
    const cosineArgument = this.#functionParts(cosine, 'cos')!.argument;
    if (!sineArgument.equals(cosineArgument)) {
      return null;
    }
    const residual = this.#subtract(equation.lhs, equation.rhs);
    const linear = this.#dependencies.symbolicKernel.symbolic.algebra.linear(
      residual,
      {
        basis: [sine, cosine],
        domain: 'real',
        mode: 'conditional',
        algebraLimits: {
          maximumNodes: context.limits.inputNodes,
          maximumDepth: context.limits.recursionDepth,
          maximumConvolutions: context.limits.totalWork,
          maximumRebuildNodes: Math.max(
            1,
            context.limits.symbolicExpressionNodes
          )
        }
      }
    );
    if (linear.kind === 'limit') {
      const mapped: LimitResult['limit'] = linear.limit === 'algebraDepth'
        ? 'recursion-depth'
        : linear.limit === 'algebraNodes'
          ? 'input-nodes'
          : linear.limit === 'algebraRebuildNodes' ||
              linear.limit === 'canonicalNodes'
            ? 'symbolic-expression-nodes'
            : 'total-work';
      return limitResult(target, mapped);
    }
    if (linear.kind === 'not-representable') {
      return null;
    }
    const a = this.#dependencies.symbolicKernel.simplify(
      linear.view.coefficients[0]!
    );
    const b = this.#dependencies.symbolicKernel.simplify(
      linear.view.coefficients[1]!
    );
    const c = this.#dependencies.symbolicKernel.simplify(
      this.#negate(linear.view.constant)
    );
    if (this.#isZero(a) && this.#isZero(b)) {
      return null;
    }
    const radius = this.#function('sqrt', this.#add(this.#pow(a, 2), this.#pow(b, 2)));
    const phase = new this.#dependencies.FunctionNode(this.#symbol('atan2'), [b, a]);
    const transformed = new this.#dependencies.EqualityNode(
      this.#function('sin', this.#add(sineArgument, phase)),
      this.#divide(c, radius)
    );
    const direct = this.#dependencies.trigonometricSolve(transformed, target, options);
    if (direct.kind !== 'parametric') {
      return direct.kind === 'unsupported' ? null : direct;
    }
    const radiusCondition = this.#dependencies.symbolicKernel.condition('positive', radius);
    const symbolicAmplitude = nodeSymbols(a).length > 0 || nodeSymbols(b).length > 0;
    return this.#mergeFamilies(
      target,
      equation,
      [{result: direct, conditions: [radiusCondition]}],
      symbolicAmplitude
    );
  }

  #constantClassification(equation: EqualityNode, target: string): SolveResult | null {
    if (
      nodeSymbols(equation.lhs).includes(target) ||
      nodeSymbols(equation.rhs).includes(target)
    ) {
      return null;
    }
    try {
      const lhs = equation.lhs.compile().evaluate();
      const rhs = equation.rhs.compile().evaluate();
      if (typeof lhs === 'number' && typeof rhs === 'number') {
        return Math.abs(lhs - rhs) <= 1e-12 * Math.max(1, Math.abs(lhs), Math.abs(rhs))
          ? Object.freeze({kind: 'identity', target, conditions: Object.freeze([])})
          : Object.freeze({kind: 'contradiction', target, conditions: Object.freeze([])});
      }
    } catch {
      return null;
    }
    return null;
  }

  solve(equation: EqualityNode, target: string, options?: SolveOptions): SolveResult {
    if (options?.domain === 'complex') {
      return unsupportedResult(target, 'unsupported-domain');
    }
    const context = new SolverContext(target, options);
    const normalized = this.#normalize(equation, target, context);
    if ('kind' in normalized) {
      return normalized;
    }
    const constant = this.#constantClassification(normalized.equation, target);
    if (constant) {
      return constant;
    }
    const nodes = this.#targetTrigNodes(normalized.equation, target);
    if (nodes.length === 0) {
      return unsupportedResult(target, 'no-rule');
    }
    const polynomial = this.#polynomialInOneAtom(
      normalized.equation,
      target,
      nodes,
      options
    );
    if (polynomial) {
      return polynomial;
    }
    const amplitude = this.#amplitudePhase(
      normalized.equation,
      target,
      nodes,
      context,
      options
    );
    return amplitude ?? unsupportedResult(target, 'unsupported-trig-form');
  }
}

export const createCompoundTrigonometricSolve = customFactory(
  'compoundTrigonometricSolve',
  [
    'ConstantNode',
    'EqualityNode',
    'FunctionNode',
    'OperatorNode',
    'SymbolNode',
    'canonicalizeParametricFamilies',
    'polynomialSolve',
    'trigonometricSolve',
    'symbolicKernel'
  ],
  (rawDependencies) => {
    const engine = new CompoundTrigonometricEngine(
      rawDependencies as unknown as CompoundDependencies
    );
    return (
      equation: EqualityNode,
      target: string,
      options?: SolveOptions
    ) => engine.solve(equation, target, options);
  }
);
