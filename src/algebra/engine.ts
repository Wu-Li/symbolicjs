import {
  isConstantNode,
  isFunctionNode,
  isOperatorNode,
  isParenthesisNode,
  isSymbolNode
} from 'mathjs';
import type {MathNode} from 'mathjs';
import {CanonicalizationEngine} from '../core/canonicalize/engine.js';
import type {
  CanonicalizationResult,
  NormalizedCanonicalizationOptions
} from '../core/canonicalize/types.js';
import {DefinednessAnalyzer} from '../core/definedness.js';
import {MathAdapter} from '../core/math-adapter.js';
import {NodeBuilder} from '../core/node-builder.js';
import type {
  OperationContext,
  OperationContextOptions,
  OperationLimitExceeded
} from '../core/operation-context.js';
import {
  predicateKey,
  PredicateFactory
} from '../core/predicate.js';
import type {SymbolicPredicate} from '../core/predicate.js';
import {PredicateEngine} from '../core/semantic-engine.js';
import {StructuralEngine} from '../core/structure.js';
import {ExpressionAnalyzer} from './analysis.js';
import {
  algebraLimit,
  compareExponentVectors,
  exponentKey,
  freezeRequirements,
  isAlgebraFailure,
  normalizeAlgebraLimits,
  notRepresentable,
  totalDegree,
  viewSuccess
} from './internal.js';
import type {
  AffineView,
  AffineViewOptions,
  AlgebraGenerator,
  AlgebraLimits,
  AlgebraNotRepresentable,
  AlgebraOptions,
  AlgebraViewResult,
  ExpressionAnalysisOptions,
  ExpressionAnalysisResult,
  LinearForm,
  LinearFormOptions,
  PolynomialViewOptions,
  PowerView,
  ProductView,
  RationalFunctionView,
  SafeEvaluationResult,
  SparsePolynomialTerm,
  SparsePolynomialView,
  SumView
} from './types.js';

export type AlgebraOperationFactory = (
  options?: OperationContextOptions
) => OperationContext;

interface GeneratorSet {
  readonly nodes: readonly MathNode[];
  readonly keys: readonly string[];
  readonly supportSymbols: ReadonlySet<string>;
}

interface WorkingState {
  readonly context: OperationContext;
  readonly limits: AlgebraLimits;
  readonly requirements: Map<string, SymbolicPredicate>;
  readonly active: WeakSet<object>;
  nodes: number;
  convolutions: number;
}

interface LinearData {
  readonly constant: MathNode;
  readonly coefficients: readonly MathNode[];
}

interface PolynomialDataTerm {
  readonly exponents: readonly number[];
  readonly coefficient: MathNode;
}

type PolynomialData = Map<string, PolynomialDataTerm>;

interface RationalData {
  readonly numerator: PolynomialData;
  readonly denominator: PolynomialData;
}

type InternalResult<T> =
  | {readonly kind: 'value'; readonly value: T}
  | AlgebraNotRepresentable
  | OperationLimitExceeded;

function isInternalFailure<T>(
  result: InternalResult<T>
): result is AlgebraNotRepresentable | OperationLimitExceeded {
  return result.kind !== 'value';
}

function valueResult<T>(value: T): {readonly kind: 'value'; readonly value: T} {
  return Object.freeze({kind: 'value', value});
}

function nonemptyName(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a nonempty string`);
  }
  return value;
}

/**
 * MathJS-native structural algebra services and transient algebraic views.
 *
 * The engine does not introduce a second expression AST. Views hold MathJS nodes,
 * explicit generator metadata, and deterministic rebuild functions.
 */
export class AlgebraEngine {
  readonly #math: MathAdapter;
  readonly #nodes: NodeBuilder;
  readonly #predicates: PredicateFactory;
  readonly #semantics: PredicateEngine;
  readonly #definedness: DefinednessAnalyzer;
  readonly #structure: StructuralEngine;
  readonly #canonicalization: CanonicalizationEngine;
  readonly #analyzer: ExpressionAnalyzer;
  readonly #createOperation: AlgebraOperationFactory;

  constructor(
    math: MathAdapter,
    nodes: NodeBuilder,
    predicates: PredicateFactory,
    semantics: PredicateEngine,
    definedness: DefinednessAnalyzer,
    structure: StructuralEngine,
    canonicalization: CanonicalizationEngine,
    createOperation: AlgebraOperationFactory
  ) {
    this.#math = math;
    this.#nodes = nodes;
    this.#predicates = predicates;
    this.#semantics = semantics;
    this.#definedness = definedness;
    this.#structure = structure;
    this.#canonicalization = canonicalization;
    this.#analyzer = new ExpressionAnalyzer(math, definedness, structure);
    this.#createOperation = createOperation;
    Object.freeze(this);
  }

  freeSymbols(node: MathNode): readonly string[] {
    return this.#analyzer.freeSymbols(node);
  }

  dependsOn(
    node: MathNode,
    symbols: readonly string[],
    atoms: readonly MathNode[] = []
  ): boolean {
    return this.#analyzer.dependsOn(node, symbols, atoms);
  }

  occurrenceCount(
    node: MathNode,
    symbols: readonly string[],
    atoms: readonly MathNode[] = []
  ): number {
    return this.#analyzer.occurrenceCount(node, symbols, atoms);
  }

  evaluate(
    node: MathNode,
    options: AlgebraOptions = {}
  ): SafeEvaluationResult {
    const {context} = this.#operation(options, 'strict');
    return this.#analyzer.safeEvaluate(node, context);
  }

  analyze(
    node: MathNode,
    options: ExpressionAnalysisOptions = {}
  ): ExpressionAnalysisResult {
    const {context} = this.#operation(options, 'strict');
    return this.#analyzer.analyze(node, context, options);
  }

  sum(
    node: MathNode,
    options: AlgebraOptions = {}
  ): AlgebraViewResult<SumView> {
    const {context, limits} = this.#operation(options, 'conditional');
    return this.#sumWithContext(node, context, limits);
  }

  product(
    node: MathNode,
    options: AlgebraOptions = {}
  ): AlgebraViewResult<ProductView> {
    const {context, limits} = this.#operation(options, 'conditional');
    return this.#productWithContext(node, context, limits);
  }

  power(
    node: MathNode,
    options: AlgebraOptions = {}
  ): AlgebraViewResult<PowerView> {
    const {context, limits} = this.#operation(options, 'conditional');
    return this.#powerWithContext(node, context, limits);
  }

  affine(
    node: MathNode,
    options: AffineViewOptions
  ): AlgebraViewResult<AffineView> {
    if (!options || typeof options !== 'object') {
      throw new TypeError('Affine view options are required');
    }
    const {context, limits} = this.#operation(options, 'conditional');
    const generators = this.#normalizeGenerators([options.generator]);
    if ('kind' in generators) {
      return generators;
    }
    const linear = this.#linearWithContext(node, generators, context, limits);
    if (isAlgebraFailure(linear)) {
      return linear;
    }
    const linearView = linear.view;
    const view: AffineView = Object.freeze({
      kind: 'affine',
      source: node,
      generator: generators.nodes[0]!,
      coefficient: linearView.coefficients[0]!,
      constant: linearView.constant,
      requirements: linearView.requirements,
      rebuild: () => linearView.rebuild()
    });
    return viewSuccess(view);
  }

  linear(
    node: MathNode,
    options: LinearFormOptions
  ): AlgebraViewResult<LinearForm> {
    if (!options || typeof options !== 'object') {
      throw new TypeError('Linear-form options are required');
    }
    const {context, limits} = this.#operation(options, 'conditional');
    const generators = this.#normalizeGenerators(options.basis);
    if ('kind' in generators) {
      return generators;
    }
    return this.#linearWithContext(node, generators, context, limits);
  }

  polynomial(
    node: MathNode,
    options: PolynomialViewOptions
  ): AlgebraViewResult<SparsePolynomialView> {
    if (!options || typeof options !== 'object') {
      throw new TypeError('Polynomial view options are required');
    }
    const {context, limits} = this.#operation(options, 'conditional');
    const generators = this.#normalizeGenerators(options.generators);
    if ('kind' in generators) {
      return generators;
    }
    return this.#polynomialWithContext(node, generators, context, limits);
  }

  rational(
    node: MathNode,
    options: PolynomialViewOptions
  ): AlgebraViewResult<RationalFunctionView> {
    if (!options || typeof options !== 'object') {
      throw new TypeError('Rational view options are required');
    }
    const {context, limits} = this.#operation(options, 'conditional');
    const generators = this.#normalizeGenerators(options.generators);
    if ('kind' in generators) {
      return generators;
    }
    return this.#rationalWithContext(node, generators, context, limits);
  }

  /** Internal bridge used by SymbolicContext for polynomial/rational profiles. */
  canonicalizeProfile(
    node: MathNode,
    context: OperationContext,
    options: NormalizedCanonicalizationOptions,
    suppliedGenerators?: readonly AlgebraGenerator[]
  ): CanonicalizationResult {
    const profile = options.profile;
    if (profile !== 'polynomial' && profile !== 'rational') {
      return this.#canonicalization.canonicalize(node, context, options);
    }
    const base = this.#canonicalization.canonicalize(node, context, {
      ...options,
      profile: 'scalar'
    });
    if (base.limit) {
      return Object.freeze({...base, profile});
    }
    const inferred = suppliedGenerators ?? this.freeSymbols(base.expression);
    if (suppliedGenerators === undefined && inferred.length === 0) {
      return Object.freeze({...base, profile});
    }
    const generators = this.#normalizeGenerators(inferred);
    if ('kind' in generators) {
      return Object.freeze({...base, profile, complete: false});
    }
    const limits = normalizeAlgebraLimits({
      maximumNodes: options.maximumNodes,
      maximumMonomials: options.maximumNodes,
      maximumConvolutions: options.maximumSteps,
      maximumRebuildNodes: options.maximumNodes
    });
    const view = profile === 'polynomial'
      ? this.#polynomialWithContext(base.expression, generators, context, limits)
      : this.#rationalWithContext(base.expression, generators, context, limits);
    if (view.kind === 'limit') {
      return Object.freeze({
        ...base,
        profile,
        complete: false,
        limit: view
      });
    }
    if (view.kind === 'not-representable') {
      return Object.freeze({...base, profile, complete: false});
    }
    const expression = view.view.rebuild();
    const requirements = freezeRequirements([
      ...base.requirements,
      ...view.view.requirements
    ]);
    const before = this.#structure.fingerprint(base.expression, {
      parentheses: 'preserve'
    });
    const after = this.#structure.fingerprint(expression, {
      parentheses: 'preserve'
    });
    const rule = profile === 'polynomial'
      ? 'rebuild-polynomial'
      : 'rebuild-rational';
    const trace = before === after
      ? base.trace
      : Object.freeze([
        ...base.trace,
        Object.freeze({rule, before, after, requirements: view.view.requirements})
      ]);
    return Object.freeze({
      expression,
      profile,
      changed: this.#structure.key(node, {parentheses: 'preserve'}) !==
        this.#structure.key(expression, {parentheses: 'preserve'}),
      complete: base.complete,
      requirements,
      trace
    });
  }

  #operation(
    options: AlgebraOptions,
    defaultMode: 'strict' | 'conditional'
  ): {readonly context: OperationContext; readonly limits: AlgebraLimits} {
    const {
      algebraLimits,
      assumptions,
      scope,
      domain,
      limits: operationLimits,
      mode,
      diagnostics
    } = options;
    return Object.freeze({
      context: this.#createOperation({
        ...(assumptions === undefined ? {} : {assumptions}),
        ...(scope === undefined ? {} : {scope}),
        ...(domain === undefined ? {} : {domain}),
        ...(operationLimits === undefined ? {} : {limits: operationLimits}),
        mode: mode ?? defaultMode,
        ...(diagnostics === undefined ? {} : {diagnostics})
      }),
      limits: normalizeAlgebraLimits(algebraLimits)
    });
  }

  #normalizeGenerators(
    inputs: readonly AlgebraGenerator[]
  ): GeneratorSet | AlgebraNotRepresentable {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      throw new TypeError('At least one algebra generator is required');
    }
    const nodes = inputs.map((input) => {
      if (typeof input === 'string') {
        return this.#nodes.symbol(nonemptyName(input, 'Generator name'));
      }
      if (!this.#math.isNode(input)) {
        throw new TypeError('Algebra generators must be symbol names or MathJS nodes');
      }
      return input;
    });
    const keys = nodes.map((node) => this.#structure.key(node, {
      parentheses: 'transparent'
    }));
    if (new Set(keys).size !== keys.length) {
      return notRepresentable(nodes[0]!, 'duplicate-generator');
    }
    const supportSymbols = new Set<string>();
    for (const node of nodes) {
      for (const symbol of this.freeSymbols(node)) {
        supportSymbols.add(symbol);
      }
    }
    return Object.freeze({
      nodes: Object.freeze(nodes),
      keys: Object.freeze(keys),
      supportSymbols
    });
  }

  #state(context: OperationContext, limits: AlgebraLimits): WorkingState {
    return {
      context,
      limits,
      requirements: new Map(),
      active: new WeakSet(),
      nodes: 0,
      convolutions: 0
    };
  }

  #enter(
    node: MathNode,
    depth: number,
    state: WorkingState
  ): OperationLimitExceeded | null {
    if (state.active.has(node as object)) {
      throw new TypeError('Cyclic MathJS node encountered during algebra analysis');
    }
    if (depth > state.limits.maximumDepth) {
      return algebraLimit('algebraDepth', depth, state.limits.maximumDepth);
    }
    state.nodes += 1;
    if (state.nodes > state.limits.maximumNodes) {
      return algebraLimit('algebraNodes', state.nodes, state.limits.maximumNodes);
    }
    state.active.add(node as object);
    return null;
  }

  #leave(node: MathNode, state: WorkingState): void {
    state.active.delete(node as object);
  }

  #addRequirements(
    state: WorkingState,
    requirements: Iterable<SymbolicPredicate>
  ): void {
    for (const requirement of requirements) {
      state.requirements.set(predicateKey(requirement), requirement);
    }
  }

  #requireScalar(
    nodes: readonly MathNode[],
    state: WorkingState
  ): AlgebraNotRepresentable | null {
    for (const node of nodes) {
      const result = this.#semantics.require(
        this.#predicates.scalar(node),
        state.context
      );
      if (result.kind === 'rejected') {
        return notRepresentable(node, 'scalar-unproven');
      }
      if (result.kind === 'conditional') {
        this.#addRequirements(state, result.requirements);
      }
    }
    return null;
  }

  #canonical(
    node: MathNode,
    state: WorkingState
  ): InternalResult<MathNode> {
    const result = this.#canonicalization.canonicalize(node, state.context, {
      profile: 'scalar',
      maximumNodes: state.limits.maximumRebuildNodes,
      maximumPasses: 8,
      maximumSteps: Math.max(1, state.limits.maximumConvolutions)
    });
    this.#addRequirements(state, result.requirements);
    if (result.limit) {
      return result.limit;
    }
    return valueResult(result.expression);
  }

  #operator(
    op: string,
    fn: string,
    args: readonly MathNode[],
    state: WorkingState
  ): InternalResult<MathNode> {
    return this.#canonical(this.#nodes.operator(op, fn, args), state);
  }

  #negate(node: MathNode, state: WorkingState): InternalResult<MathNode> {
    return this.#operator('-', 'unaryMinus', [node], state);
  }

  #add(
    left: MathNode,
    right: MathNode,
    state: WorkingState,
    subtract = false
  ): InternalResult<MathNode> {
    return this.#operator(
      subtract ? '-' : '+',
      subtract ? 'subtract' : 'add',
      [left, right],
      state
    );
  }

  #multiply(
    left: MathNode,
    right: MathNode,
    state: WorkingState
  ): InternalResult<MathNode> {
    return this.#operator('*', 'multiply', [left, right], state);
  }

  #divide(
    numerator: MathNode,
    denominator: MathNode,
    state: WorkingState
  ): InternalResult<MathNode> {
    const predicate = this.#predicates.nonzero(denominator);
    const requirement = this.#semantics.require(predicate, state.context);
    if (requirement.kind === 'rejected') {
      return notRepresentable(
        denominator,
        requirement.judgment.truth === 'disproven'
          ? 'zero-denominator'
          : 'nonzero-unproven'
      );
    }
    if (requirement.kind === 'conditional') {
      this.#addRequirements(state, requirement.requirements);
    }
    return this.#operator('/', 'divide', [numerator, denominator], state);
  }

  #pow(
    base: MathNode,
    exponent: number,
    state: WorkingState
  ): InternalResult<MathNode> {
    return this.#operator('^', 'pow', [base, this.#nodes.constant(exponent)], state);
  }

  #buildAssociative(
    op: '+' | '*',
    fn: 'add' | 'multiply',
    values: readonly MathNode[],
    identity: 0 | 1,
    state: WorkingState
  ): InternalResult<MathNode> {
    if (values.length === 0) {
      return valueResult(this.#nodes.constant(identity));
    }
    let result = values[0]!;
    for (const value of values.slice(1)) {
      const combined = this.#operator(op, fn, [result, value], state);
      if (isInternalFailure(combined)) {
        return combined;
      }
      result = combined.value;
    }
    return valueResult(result);
  }

  #safeValue(node: MathNode, context: OperationContext): unknown | null {
    if (isConstantNode(node)) {
      return node.value;
    }
    if (isSymbolNode(node)) {
      if (Object.prototype.hasOwnProperty.call(context.scope, node.name)) {
        return context.scope[node.name];
      }
      if (this.#math.has(node.name)) {
        return this.#math.lookup(node.name) ?? null;
      }
    }
    const evaluated = this.#analyzer.safeEvaluate(node, context);
    return evaluated.kind === 'value' ? evaluated.value : null;
  }

  #constantEquals(
    node: MathNode,
    expected: number,
    context: OperationContext
  ): boolean {
    const value = this.#safeValue(node, context);
    if (value === null) {
      return false;
    }
    const equal = this.#math.lookup('equal');
    if (typeof equal === 'function') {
      try {
        return (equal as (left: unknown, right: unknown) => unknown)(
          value,
          expected
        ) === true;
      } catch {
        // Fall through to primitive/valueOf comparison.
      }
    }
    if (typeof value === 'number') {
      return value === expected || Object.is(value, expected);
    }
    if (typeof value === 'bigint') {
      return value === BigInt(expected);
    }
    if (
      value &&
      typeof value === 'object' &&
      'valueOf' in value &&
      typeof value.valueOf === 'function'
    ) {
      return Number(value.valueOf()) === expected;
    }
    return false;
  }

  #asSafeInteger(node: MathNode, context: OperationContext): number | null {
    const value = this.#safeValue(node, context);
    if (typeof value === 'number') {
      return Number.isSafeInteger(value) ? value : null;
    }
    if (typeof value === 'bigint') {
      const converted = Number(value);
      return Number.isSafeInteger(converted) ? converted : null;
    }
    if (
      value &&
      typeof value === 'object' &&
      'isInteger' in value &&
      typeof value.isInteger === 'function' &&
      value.isInteger()
    ) {
      const converted = Number(value.valueOf());
      return Number.isSafeInteger(converted) ? converted : null;
    }
    if (
      value &&
      typeof value === 'object' &&
      'd' in value &&
      'n' in value &&
      's' in value &&
      Number(value.d) === 1
    ) {
      const converted = Number(value.s) * Number(value.n);
      return Number.isSafeInteger(converted) ? converted : null;
    }
    return null;
  }

  #generatorIndex(node: MathNode, generators: GeneratorSet): number {
    const key = this.#structure.key(node, {parentheses: 'transparent'});
    return generators.keys.indexOf(key);
  }

  #dependsOnGenerators(node: MathNode, generators: GeneratorSet): boolean {
    if (this.#generatorIndex(node, generators) >= 0) {
      return true;
    }
    if (
      this.freeSymbols(node).some((symbol) => generators.supportSymbols.has(symbol))
    ) {
      return true;
    }
    let found = false;
    node.traverse((candidate, path, parent) => {
      if (parent && isFunctionNode(parent) && path === 'fn') {
        return;
      }
      if (!found && this.#generatorIndex(candidate, generators) >= 0) {
        found = true;
      }
    });
    return found;
  }

  #sumWithContext(
    node: MathNode,
    context: OperationContext,
    limits: AlgebraLimits
  ): AlgebraViewResult<SumView> {
    if (!this.#math.isNode(node)) {
      throw new TypeError('MathJS node expected for SumView');
    }
    const state = this.#state(context, limits);
    const scalar = this.#requireScalar([node], state);
    if (scalar) {
      return scalar;
    }
    const canonical = this.#canonical(node, state);
    if (isInternalFailure(canonical)) {
      return canonical;
    }
    const terms: MathNode[] = [];
    const collect = (
      current: MathNode,
      negative: boolean,
      depth: number
    ): OperationLimitExceeded | null => {
      const exceeded = this.#enter(current, depth, state);
      if (exceeded) {
        return exceeded;
      }
      try {
        if (isParenthesisNode(current)) {
          return collect(current.content, negative, depth + 1);
        }
        if (isOperatorNode(current) && current.fn === 'add') {
          for (const argument of current.args) {
            const child = collect(argument, negative, depth + 1);
            if (child) {
              return child;
            }
          }
          return null;
        }
        if (
          isOperatorNode(current) &&
          current.fn === 'subtract' &&
          current.args[0] &&
          current.args[1]
        ) {
          return collect(current.args[0], negative, depth + 1) ??
            collect(current.args[1], !negative, depth + 1);
        }
        if (
          isOperatorNode(current) &&
          current.fn === 'unaryPlus' &&
          current.args[0]
        ) {
          return collect(current.args[0], negative, depth + 1);
        }
        if (
          isOperatorNode(current) &&
          current.fn === 'unaryMinus' &&
          current.args[0]
        ) {
          return collect(current.args[0], !negative, depth + 1);
        }
        if (!negative) {
          terms.push(current);
          return null;
        }
        const negated = this.#negate(current, state);
        if (isInternalFailure(negated)) {
          return negated.kind === 'limit' ? negated : null;
        }
        terms.push(negated.value);
        return null;
      } finally {
        this.#leave(current, state);
      }
    };
    const limit = collect(canonical.value, false, 1);
    if (limit) {
      return limit;
    }
    const ordered = this.#structure.sort(terms, {parentheses: 'transparent'});
    const rebuilt = this.#buildAssociative('+', 'add', ordered, 0, state);
    if (isInternalFailure(rebuilt)) {
      return rebuilt;
    }
    const view: SumView = Object.freeze({
      kind: 'sum',
      source: node,
      terms: ordered,
      requirements: freezeRequirements(state.requirements.values()),
      rebuild: () => rebuilt.value
    });
    return viewSuccess(view);
  }

  #productWithContext(
    node: MathNode,
    context: OperationContext,
    limits: AlgebraLimits
  ): AlgebraViewResult<ProductView> {
    if (!this.#math.isNode(node)) {
      throw new TypeError('MathJS node expected for ProductView');
    }
    const state = this.#state(context, limits);
    const scalar = this.#requireScalar([node], state);
    if (scalar) {
      return scalar;
    }
    const canonical = this.#canonical(node, state);
    if (isInternalFailure(canonical)) {
      return canonical;
    }
    const factors: MathNode[] = [];
    const collect = (current: MathNode, depth: number): OperationLimitExceeded | null => {
      const exceeded = this.#enter(current, depth, state);
      if (exceeded) {
        return exceeded;
      }
      try {
        if (isParenthesisNode(current)) {
          return collect(current.content, depth + 1);
        }
        if (isOperatorNode(current) && current.fn === 'multiply') {
          for (const argument of current.args) {
            const child = collect(argument, depth + 1);
            if (child) {
              return child;
            }
          }
          return null;
        }
        factors.push(current);
        return null;
      } finally {
        this.#leave(current, state);
      }
    };
    const limit = collect(canonical.value, 1);
    if (limit) {
      return limit;
    }
    const ordered = this.#structure.sort(factors, {parentheses: 'transparent'});
    const rebuilt = this.#buildAssociative('*', 'multiply', ordered, 1, state);
    if (isInternalFailure(rebuilt)) {
      return rebuilt;
    }
    const view: ProductView = Object.freeze({
      kind: 'product',
      source: node,
      factors: ordered,
      requirements: freezeRequirements(state.requirements.values()),
      rebuild: () => rebuilt.value
    });
    return viewSuccess(view);
  }

  #powerWithContext(
    node: MathNode,
    context: OperationContext,
    limits: AlgebraLimits
  ): AlgebraViewResult<PowerView> {
    if (!this.#math.isNode(node)) {
      throw new TypeError('MathJS node expected for PowerView');
    }
    const state = this.#state(context, limits);
    const canonical = this.#canonical(node, state);
    if (isInternalFailure(canonical)) {
      return canonical;
    }
    const expression = canonical.value;
    if (
      !isOperatorNode(expression) ||
      expression.fn !== 'pow' ||
      !expression.args[0] ||
      !expression.args[1]
    ) {
      return notRepresentable(node, 'unsupported-node', 'Expected a power expression');
    }
    const scalar = this.#requireScalar(expression.args, state);
    if (scalar) {
      return scalar;
    }
    const view: PowerView = Object.freeze({
      kind: 'power',
      source: node,
      base: expression.args[0],
      exponent: expression.args[1],
      requirements: freezeRequirements(state.requirements.values()),
      rebuild: () => expression
    });
    return viewSuccess(view);
  }

  #linearWithContext(
    node: MathNode,
    generators: GeneratorSet,
    context: OperationContext,
    limits: AlgebraLimits
  ): AlgebraViewResult<LinearForm> {
    if (!this.#math.isNode(node)) {
      throw new TypeError('MathJS node expected for LinearForm');
    }
    const state = this.#state(context, limits);
    const scalar = this.#requireScalar([node, ...generators.nodes], state);
    if (scalar) {
      return scalar;
    }
    const parsed = this.#parseLinear(node, generators, state, 1);
    if (isInternalFailure(parsed)) {
      return parsed;
    }
    for (const coefficient of parsed.value.coefficients) {
      if (this.#dependsOnGenerators(coefficient, generators)) {
        return notRepresentable(coefficient, 'dependent-coefficient');
      }
    }
    if (this.#dependsOnGenerators(parsed.value.constant, generators)) {
      return notRepresentable(parsed.value.constant, 'dependent-coefficient');
    }
    const rebuilt = this.#rebuildLinear(parsed.value, generators, state);
    if (isInternalFailure(rebuilt)) {
      return rebuilt;
    }
    const coefficients = Object.freeze([...parsed.value.coefficients]);
    const requirements = freezeRequirements(state.requirements.values());
    const coefficientOf = (generator: number | AlgebraGenerator): MathNode | null => {
      let index: number;
      if (typeof generator === 'number') {
        index = generator;
      } else {
        const candidate = typeof generator === 'string'
          ? this.#nodes.symbol(nonemptyName(generator, 'Generator name'))
          : generator;
        if (!this.#math.isNode(candidate)) {
          throw new TypeError('Linear-form generator must be an index, name, or MathJS node');
        }
        index = generators.keys.indexOf(this.#structure.key(candidate, {
          parentheses: 'transparent'
        }));
      }
      return Number.isSafeInteger(index) && index >= 0 && index < coefficients.length
        ? coefficients[index] ?? null
        : null;
    };
    const view: LinearForm = Object.freeze({
      kind: 'linear-form',
      source: node,
      basis: generators.nodes,
      coefficients,
      constant: parsed.value.constant,
      requirements,
      coefficientOf,
      rebuild: () => rebuilt.value
    });
    return viewSuccess(view);
  }

  #parseLinear(
    node: MathNode,
    generators: GeneratorSet,
    state: WorkingState,
    depth: number
  ): InternalResult<LinearData> {
    const exceeded = this.#enter(node, depth, state);
    if (exceeded) {
      return exceeded;
    }
    try {
      const generatorIndex = this.#generatorIndex(node, generators);
      if (generatorIndex >= 0) {
        return valueResult({
          constant: this.#nodes.constant(0),
          coefficients: Object.freeze(generators.nodes.map((_entry, index) =>
            this.#nodes.constant(index === generatorIndex ? 1 : 0)
          ))
        });
      }
      if (!this.#dependsOnGenerators(node, generators)) {
        const constant = this.#canonical(node, state);
        return isInternalFailure(constant)
          ? constant
          : valueResult({
            constant: constant.value,
            coefficients: Object.freeze(generators.nodes.map(() =>
              this.#nodes.constant(0)
            ))
          });
      }
      if (isParenthesisNode(node)) {
        return this.#parseLinear(node.content, generators, state, depth + 1);
      }
      if (!isOperatorNode(node)) {
        return notRepresentable(node, 'unsupported-node');
      }
      if (
        node.fn === 'unaryPlus' &&
        node.args.length === 1 &&
        node.args[0]
      ) {
        return this.#parseLinear(node.args[0], generators, state, depth + 1);
      }
      if (
        node.fn === 'unaryMinus' &&
        node.args.length === 1 &&
        node.args[0]
      ) {
        const child = this.#parseLinear(node.args[0], generators, state, depth + 1);
        return isInternalFailure(child)
          ? child
          : this.#scaleLinear(child.value, this.#nodes.constant(-1), state);
      }
      if (node.args.length !== 2 || !node.args[0] || !node.args[1]) {
        return notRepresentable(node, 'unsupported-node');
      }
      if (node.fn === 'add' || node.fn === 'subtract') {
        const left = this.#parseLinear(node.args[0], generators, state, depth + 1);
        if (isInternalFailure(left)) {
          return left;
        }
        const right = this.#parseLinear(node.args[1], generators, state, depth + 1);
        if (isInternalFailure(right)) {
          return right;
        }
        return this.#combineLinear(left.value, right.value, node.fn === 'subtract', state);
      }
      if (node.fn === 'multiply') {
        const left = this.#parseLinear(node.args[0], generators, state, depth + 1);
        if (isInternalFailure(left)) {
          return left;
        }
        const right = this.#parseLinear(node.args[1], generators, state, depth + 1);
        if (isInternalFailure(right)) {
          return right;
        }
        const leftConstant = this.#linearIsConstant(left.value, state.context);
        const rightConstant = this.#linearIsConstant(right.value, state.context);
        if (leftConstant) {
          return this.#scaleLinear(right.value, left.value.constant, state);
        }
        if (rightConstant) {
          return this.#scaleLinear(left.value, right.value.constant, state);
        }
        return notRepresentable(node, 'nonlinear-product');
      }
      if (node.fn === 'divide') {
        const left = this.#parseLinear(node.args[0], generators, state, depth + 1);
        if (isInternalFailure(left)) {
          return left;
        }
        if (this.#dependsOnGenerators(node.args[1], generators)) {
          return notRepresentable(node.args[1], 'generator-denominator');
        }
        const reciprocal = this.#divide(
          this.#nodes.constant(1),
          node.args[1],
          state
        );
        return isInternalFailure(reciprocal)
          ? reciprocal
          : this.#scaleLinear(left.value, reciprocal.value, state);
      }
      if (node.fn === 'pow') {
        const exponent = this.#asSafeInteger(node.args[1], state.context);
        if (exponent === 1) {
          return this.#parseLinear(node.args[0], generators, state, depth + 1);
        }
        if (exponent === 0) {
          const constant = this.#canonical(node, state);
          return isInternalFailure(constant)
            ? constant
            : valueResult({
              constant: constant.value,
              coefficients: Object.freeze(generators.nodes.map(() =>
                this.#nodes.constant(0)
              ))
            });
        }
        return notRepresentable(node, 'nonlinear-product');
      }
      return notRepresentable(node, 'unsupported-node');
    } finally {
      this.#leave(node, state);
    }
  }

  #linearIsConstant(data: LinearData, context: OperationContext): boolean {
    return data.coefficients.every((coefficient) =>
      this.#constantEquals(coefficient, 0, context)
    );
  }

  #scaleLinear(
    data: LinearData,
    factor: MathNode,
    state: WorkingState
  ): InternalResult<LinearData> {
    const constant = this.#multiply(data.constant, factor, state);
    if (isInternalFailure(constant)) {
      return constant;
    }
    const coefficients: MathNode[] = [];
    for (const coefficient of data.coefficients) {
      const product = this.#multiply(coefficient, factor, state);
      if (isInternalFailure(product)) {
        return product;
      }
      coefficients.push(product.value);
    }
    return valueResult({
      constant: constant.value,
      coefficients: Object.freeze(coefficients)
    });
  }

  #combineLinear(
    left: LinearData,
    right: LinearData,
    subtract: boolean,
    state: WorkingState
  ): InternalResult<LinearData> {
    const constant = this.#add(left.constant, right.constant, state, subtract);
    if (isInternalFailure(constant)) {
      return constant;
    }
    const coefficients: MathNode[] = [];
    for (let index = 0; index < left.coefficients.length; index += 1) {
      const combined = this.#add(
        left.coefficients[index]!,
        right.coefficients[index]!,
        state,
        subtract
      );
      if (isInternalFailure(combined)) {
        return combined;
      }
      coefficients.push(combined.value);
    }
    return valueResult({
      constant: constant.value,
      coefficients: Object.freeze(coefficients)
    });
  }

  #rebuildLinear(
    data: LinearData,
    generators: GeneratorSet,
    state: WorkingState
  ): InternalResult<MathNode> {
    const terms: MathNode[] = [];
    for (let index = 0; index < generators.nodes.length; index += 1) {
      const coefficient = data.coefficients[index]!;
      if (this.#constantEquals(coefficient, 0, state.context)) {
        continue;
      }
      if (this.#constantEquals(coefficient, 1, state.context)) {
        terms.push(generators.nodes[index]!);
        continue;
      }
      const term = this.#multiply(coefficient, generators.nodes[index]!, state);
      if (isInternalFailure(term)) {
        return term;
      }
      terms.push(term.value);
    }
    if (
      terms.length === 0 ||
      !this.#constantEquals(data.constant, 0, state.context)
    ) {
      terms.push(data.constant);
    }
    return this.#buildAssociative('+', 'add', terms, 0, state);
  }

  #polynomialWithContext(
    node: MathNode,
    generators: GeneratorSet,
    context: OperationContext,
    limits: AlgebraLimits
  ): AlgebraViewResult<SparsePolynomialView> {
    if (!this.#math.isNode(node)) {
      throw new TypeError('MathJS node expected for SparsePolynomialView');
    }
    const state = this.#state(context, limits);
    const scalar = this.#requireScalar([node, ...generators.nodes], state);
    if (scalar) {
      return scalar;
    }
    const parsed = this.#parsePolynomial(node, generators, state, 1);
    if (isInternalFailure(parsed)) {
      return parsed;
    }
    return this.#createPolynomialView(node, parsed.value, generators, state);
  }

  #parsePolynomial(
    node: MathNode,
    generators: GeneratorSet,
    state: WorkingState,
    depth: number
  ): InternalResult<PolynomialData> {
    const exceeded = this.#enter(node, depth, state);
    if (exceeded) {
      return exceeded;
    }
    try {
      const generatorIndex = this.#generatorIndex(node, generators);
      if (generatorIndex >= 0) {
        const exponents = generators.nodes.map((_entry, index) =>
          index === generatorIndex ? 1 : 0
        );
        return valueResult(new Map([[exponentKey(exponents), {
          exponents: Object.freeze(exponents),
          coefficient: this.#nodes.constant(1)
        }]]));
      }
      if (!this.#dependsOnGenerators(node, generators)) {
        const coefficient = this.#canonical(node, state);
        if (isInternalFailure(coefficient)) {
          return coefficient;
        }
        return this.#constantPolynomial(coefficient.value, generators.nodes.length, state);
      }
      if (isParenthesisNode(node)) {
        return this.#parsePolynomial(node.content, generators, state, depth + 1);
      }
      if (!isOperatorNode(node)) {
        return notRepresentable(node, 'not-polynomial');
      }
      if (
        node.fn === 'unaryPlus' &&
        node.args.length === 1 &&
        node.args[0]
      ) {
        return this.#parsePolynomial(node.args[0], generators, state, depth + 1);
      }
      if (
        node.fn === 'unaryMinus' &&
        node.args.length === 1 &&
        node.args[0]
      ) {
        const operand = this.#parsePolynomial(
          node.args[0],
          generators,
          state,
          depth + 1
        );
        return isInternalFailure(operand)
          ? operand
          : this.#scalePolynomial(operand.value, this.#nodes.constant(-1), state);
      }
      if (node.args.length !== 2 || !node.args[0] || !node.args[1]) {
        return notRepresentable(node, 'not-polynomial');
      }
      if (node.fn === 'add' || node.fn === 'subtract') {
        const left = this.#parsePolynomial(
          node.args[0],
          generators,
          state,
          depth + 1
        );
        if (isInternalFailure(left)) {
          return left;
        }
        const right = this.#parsePolynomial(
          node.args[1],
          generators,
          state,
          depth + 1
        );
        return isInternalFailure(right)
          ? right
          : this.#addPolynomial(
            left.value,
            right.value,
            state,
            node.fn === 'subtract'
          );
      }
      if (node.fn === 'multiply') {
        const left = this.#parsePolynomial(
          node.args[0],
          generators,
          state,
          depth + 1
        );
        if (isInternalFailure(left)) {
          return left;
        }
        const right = this.#parsePolynomial(
          node.args[1],
          generators,
          state,
          depth + 1
        );
        return isInternalFailure(right)
          ? right
          : this.#multiplyPolynomial(left.value, right.value, state);
      }
      if (node.fn === 'divide') {
        if (this.#dependsOnGenerators(node.args[1], generators)) {
          return notRepresentable(node.args[1], 'generator-denominator');
        }
        const numerator = this.#parsePolynomial(
          node.args[0],
          generators,
          state,
          depth + 1
        );
        if (isInternalFailure(numerator)) {
          return numerator;
        }
        const reciprocal = this.#divide(
          this.#nodes.constant(1),
          node.args[1],
          state
        );
        return isInternalFailure(reciprocal)
          ? reciprocal
          : this.#scalePolynomial(numerator.value, reciprocal.value, state);
      }
      if (node.fn === 'pow') {
        if (this.#dependsOnGenerators(node.args[1], generators)) {
          return notRepresentable(node.args[1], 'nonconstant-exponent');
        }
        const evaluation = this.#analyzer.safeEvaluate(node.args[1], state.context);
        if (evaluation.kind !== 'value') {
          return notRepresentable(node.args[1], 'nonconstant-exponent');
        }
        const exponent = this.#asSafeInteger(node.args[1], state.context);
        if (exponent === null) {
          return notRepresentable(node.args[1], 'nonintegral-exponent');
        }
        if (exponent < 0) {
          return notRepresentable(node, 'negative-exponent');
        }
        const base = this.#parsePolynomial(
          node.args[0],
          generators,
          state,
          depth + 1
        );
        return isInternalFailure(base)
          ? base
          : this.#powerPolynomial(
            base.value,
            exponent,
            state,
            generators.nodes.length
          );
      }
      return notRepresentable(node, 'not-polynomial');
    } finally {
      this.#leave(node, state);
    }
  }

  #constantPolynomial(
    coefficient: MathNode,
    generatorCount: number,
    state: WorkingState
  ): InternalResult<PolynomialData> {
    if (this.#constantEquals(coefficient, 0, state.context)) {
      return valueResult(new Map());
    }
    const exponents = Object.freeze(Array.from({length: generatorCount}, () => 0));
    return valueResult(new Map([[exponentKey(exponents), {
      exponents,
      coefficient
    }]]));
  }

  #normalizePolynomial(
    polynomial: PolynomialData,
    state: WorkingState
  ): InternalResult<PolynomialData> {
    const normalized: PolynomialData = new Map();
    for (const term of polynomial.values()) {
      const degree = totalDegree(term.exponents);
      if (degree > state.limits.maximumDegree) {
        return algebraLimit(
          'algebraDegree',
          degree,
          state.limits.maximumDegree
        );
      }
      const coefficient = this.#canonical(term.coefficient, state);
      if (isInternalFailure(coefficient)) {
        return coefficient;
      }
      if (!this.#constantEquals(coefficient.value, 0, state.context)) {
        normalized.set(exponentKey(term.exponents), {
          exponents: Object.freeze([...term.exponents]),
          coefficient: coefficient.value
        });
      }
    }
    if (normalized.size > state.limits.maximumMonomials) {
      return algebraLimit(
        'algebraMonomials',
        normalized.size,
        state.limits.maximumMonomials
      );
    }
    return valueResult(normalized);
  }

  #addPolynomial(
    left: PolynomialData,
    right: PolynomialData,
    state: WorkingState,
    subtract = false
  ): InternalResult<PolynomialData> {
    const result: PolynomialData = new Map(left);
    for (const [key, term] of right) {
      const existing = result.get(key);
      if (!existing) {
        if (!subtract) {
          result.set(key, term);
          continue;
        }
        const negated = this.#negate(term.coefficient, state);
        if (isInternalFailure(negated)) {
          return negated;
        }
        result.set(key, {
          exponents: term.exponents,
          coefficient: negated.value
        });
        continue;
      }
      const coefficient = this.#add(
        existing.coefficient,
        term.coefficient,
        state,
        subtract
      );
      if (isInternalFailure(coefficient)) {
        return coefficient;
      }
      result.set(key, {
        exponents: existing.exponents,
        coefficient: coefficient.value
      });
    }
    return this.#normalizePolynomial(result, state);
  }

  #scalePolynomial(
    polynomial: PolynomialData,
    factor: MathNode,
    state: WorkingState
  ): InternalResult<PolynomialData> {
    const result: PolynomialData = new Map();
    for (const [key, term] of polynomial) {
      const coefficient = this.#multiply(term.coefficient, factor, state);
      if (isInternalFailure(coefficient)) {
        return coefficient;
      }
      result.set(key, {
        exponents: term.exponents,
        coefficient: coefficient.value
      });
    }
    return this.#normalizePolynomial(result, state);
  }

  #multiplyPolynomial(
    left: PolynomialData,
    right: PolynomialData,
    state: WorkingState
  ): InternalResult<PolynomialData> {
    if (left.size === 0 || right.size === 0) {
      return valueResult(new Map());
    }
    const result: PolynomialData = new Map();
    for (const leftTerm of left.values()) {
      for (const rightTerm of right.values()) {
        state.convolutions += 1;
        if (state.convolutions > state.limits.maximumConvolutions) {
          return algebraLimit(
            'algebraConvolutions',
            state.convolutions,
            state.limits.maximumConvolutions
          );
        }
        const exponents = leftTerm.exponents.map((value, index) =>
          value + (rightTerm.exponents[index] ?? 0)
        );
        const degree = totalDegree(exponents);
        if (degree > state.limits.maximumDegree) {
          return algebraLimit(
            'algebraDegree',
            degree,
            state.limits.maximumDegree
          );
        }
        const product = this.#multiply(
          leftTerm.coefficient,
          rightTerm.coefficient,
          state
        );
        if (isInternalFailure(product)) {
          return product;
        }
        const key = exponentKey(exponents);
        const existing = result.get(key);
        if (!existing) {
          result.set(key, {
            exponents: Object.freeze(exponents),
            coefficient: product.value
          });
        } else {
          const sum = this.#add(existing.coefficient, product.value, state);
          if (isInternalFailure(sum)) {
            return sum;
          }
          result.set(key, {
            exponents: existing.exponents,
            coefficient: sum.value
          });
        }
        if (result.size > state.limits.maximumMonomials) {
          return algebraLimit(
            'algebraMonomials',
            result.size,
            state.limits.maximumMonomials
          );
        }
      }
    }
    return this.#normalizePolynomial(result, state);
  }

  #powerPolynomial(
    polynomial: PolynomialData,
    exponent: number,
    state: WorkingState,
    generatorCount: number
  ): InternalResult<PolynomialData> {
    const one = this.#constantPolynomial(
      this.#nodes.constant(1),
      generatorCount,
      state
    );
    if (isInternalFailure(one)) {
      return one;
    }
    if (exponent === 0) {
      return one;
    }
    let result = one.value;
    let factor = polynomial;
    let remaining = exponent;
    while (remaining > 0) {
      if (remaining % 2 === 1) {
        const product = this.#multiplyPolynomial(result, factor, state);
        if (isInternalFailure(product)) {
          return product;
        }
        result = product.value;
      }
      remaining = Math.floor(remaining / 2);
      if (remaining > 0) {
        const square = this.#multiplyPolynomial(factor, factor, state);
        if (isInternalFailure(square)) {
          return square;
        }
        factor = square.value;
      }
    }
    return valueResult(result);
  }

  #createPolynomialView(
    source: MathNode,
    polynomial: PolynomialData,
    generators: GeneratorSet,
    state: WorkingState
  ): AlgebraViewResult<SparsePolynomialView> {
    const normalized = this.#normalizePolynomial(polynomial, state);
    if (isInternalFailure(normalized)) {
      return normalized;
    }
    for (const term of normalized.value.values()) {
      if (this.#dependsOnGenerators(term.coefficient, generators)) {
        return notRepresentable(term.coefficient, 'dependent-coefficient');
      }
      const scalar = this.#requireScalar([term.coefficient], state);
      if (scalar) {
        return scalar;
      }
    }
    const terms: readonly SparsePolynomialTerm[] = Object.freeze(
      [...normalized.value.values()]
        .sort((left, right) => compareExponentVectors(
          left.exponents,
          right.exponents
        ))
        .map((term) => Object.freeze({
          exponents: Object.freeze([...term.exponents]),
          coefficient: term.coefficient
        }))
    );
    const rebuilt = this.#rebuildPolynomial(terms, generators, state);
    if (isInternalFailure(rebuilt)) {
      return rebuilt;
    }
    try {
      this.#structure.analyze(rebuilt.value, {
        maximumNodes: state.limits.maximumRebuildNodes,
        maximumDepth: state.limits.maximumDepth,
        parentheses: 'preserve'
      });
    } catch (error) {
      if (error instanceof RangeError) {
        const depthExceeded = error.message.includes('maximumDepth');
        return algebraLimit(
          depthExceeded ? 'algebraDepth' : 'algebraRebuildNodes',
          (depthExceeded
            ? state.limits.maximumDepth
            : state.limits.maximumRebuildNodes) + 1,
          depthExceeded
            ? state.limits.maximumDepth
            : state.limits.maximumRebuildNodes
        );
      }
      throw error;
    }
    const total = terms.reduce((maximum, term) =>
      Math.max(maximum, totalDegree(term.exponents)), -1
    );
    const resolveGenerator = (generator: number | AlgebraGenerator): number => {
      if (typeof generator === 'number') {
        return generator;
      }
      const node = typeof generator === 'string'
        ? this.#nodes.symbol(nonemptyName(generator, 'Generator name'))
        : generator;
      if (!this.#math.isNode(node)) {
        throw new TypeError('Polynomial generator must be an index, name, or MathJS node');
      }
      return generators.keys.indexOf(this.#structure.key(node, {
        parentheses: 'transparent'
      }));
    };
    const degree = (generator?: number | AlgebraGenerator): number => {
      if (generator === undefined) {
        return total;
      }
      const index = resolveGenerator(generator);
      if (!Number.isSafeInteger(index) || index < 0 || index >= generators.nodes.length) {
        return -1;
      }
      return terms.reduce((maximum, term) =>
        Math.max(maximum, term.exponents[index] ?? 0), -1
      );
    };
    const coefficient = (exponents: readonly number[]): MathNode | null => {
      if (
        !Array.isArray(exponents) ||
        exponents.length !== generators.nodes.length ||
        exponents.some((entry) => !Number.isSafeInteger(entry) || entry < 0)
      ) {
        throw new TypeError('Polynomial exponents must be nonnegative safe integers');
      }
      return terms.find((term) =>
        exponentKey(term.exponents) === exponentKey(exponents)
      )?.coefficient ?? null;
    };
    const view: SparsePolynomialView = Object.freeze({
      kind: 'sparse-polynomial',
      source,
      generators: generators.nodes,
      terms,
      totalDegree: total,
      requirements: freezeRequirements(state.requirements.values()),
      degree,
      coefficient,
      rebuild: () => rebuilt.value
    });
    return viewSuccess(view);
  }

  #rebuildPolynomial(
    terms: readonly SparsePolynomialTerm[],
    generators: GeneratorSet,
    state: WorkingState
  ): InternalResult<MathNode> {
    const resultTerms: MathNode[] = [];
    for (const term of terms) {
      const monomial = this.#buildMonomial(term.exponents, generators, state);
      if (isInternalFailure(monomial)) {
        return monomial;
      }
      const monomialIsOne = this.#constantEquals(
        monomial.value,
        1,
        state.context
      );
      if (monomialIsOne) {
        resultTerms.push(term.coefficient);
      } else if (this.#constantEquals(term.coefficient, 1, state.context)) {
        resultTerms.push(monomial.value);
      } else {
        const product = this.#multiply(term.coefficient, monomial.value, state);
        if (isInternalFailure(product)) {
          return product;
        }
        resultTerms.push(product.value);
      }
    }
    return this.#buildAssociative('+', 'add', resultTerms, 0, state);
  }

  #buildMonomial(
    exponents: readonly number[],
    generators: GeneratorSet,
    state: WorkingState
  ): InternalResult<MathNode> {
    const factors: MathNode[] = [];
    for (let index = 0; index < exponents.length; index += 1) {
      const exponent = exponents[index] ?? 0;
      if (exponent === 0) {
        continue;
      }
      if (exponent === 1) {
        factors.push(generators.nodes[index]!);
        continue;
      }
      const power = this.#pow(generators.nodes[index]!, exponent, state);
      if (isInternalFailure(power)) {
        return power;
      }
      factors.push(power.value);
    }
    return this.#buildAssociative('*', 'multiply', factors, 1, state);
  }

  #requirePredicates(
    predicates: readonly SymbolicPredicate[],
    state: WorkingState
  ): AlgebraNotRepresentable | null {
    for (const predicate of predicates) {
      const result = this.#semantics.require(predicate, state.context);
      if (result.kind === 'rejected') {
        return notRepresentable(
          predicate.expression,
          result.judgment.truth === 'disproven'
            ? 'zero-denominator'
            : 'nonzero-unproven'
        );
      }
      if (result.kind === 'conditional') {
        this.#addRequirements(state, result.requirements);
      }
    }
    return null;
  }

  #rationalWithContext(
    node: MathNode,
    generators: GeneratorSet,
    context: OperationContext,
    limits: AlgebraLimits
  ): AlgebraViewResult<RationalFunctionView> {
    if (!this.#math.isNode(node)) {
      throw new TypeError('MathJS node expected for RationalFunctionView');
    }
    const state = this.#state(context, limits);
    const scalar = this.#requireScalar([node, ...generators.nodes], state);
    if (scalar) {
      return scalar;
    }
    const definedness = this.#definedness.requirements(node, {
      domain: context.domain,
      includeLeafDefinedness: false
    });
    const defined = this.#requirePredicates(definedness, state);
    if (defined) {
      return defined;
    }
    const parsed = this.#parseRational(node, generators, state, 1);
    if (isInternalFailure(parsed)) {
      return parsed;
    }
    return this.#createRationalView(node, parsed.value, generators, state);
  }

  #parseRational(
    node: MathNode,
    generators: GeneratorSet,
    state: WorkingState,
    depth: number
  ): InternalResult<RationalData> {
    const exceeded = this.#enter(node, depth, state);
    if (exceeded) {
      return exceeded;
    }
    try {
      const generatorIndex = this.#generatorIndex(node, generators);
      if (generatorIndex >= 0) {
        const exponents = generators.nodes.map((_entry, index) =>
          index === generatorIndex ? 1 : 0
        );
        return valueResult({
          numerator: new Map([[exponentKey(exponents), {
            exponents: Object.freeze(exponents),
            coefficient: this.#nodes.constant(1)
          }]]),
          denominator: this.#onePolynomial(generators.nodes.length)
        });
      }
      if (!this.#dependsOnGenerators(node, generators)) {
        const coefficient = this.#canonical(node, state);
        if (isInternalFailure(coefficient)) {
          return coefficient;
        }
        const constant = this.#constantPolynomial(
          coefficient.value,
          generators.nodes.length,
          state
        );
        return isInternalFailure(constant)
          ? constant
          : valueResult({
            numerator: constant.value,
            denominator: this.#onePolynomial(generators.nodes.length)
          });
      }
      if (isParenthesisNode(node)) {
        return this.#parseRational(node.content, generators, state, depth + 1);
      }
      if (!isOperatorNode(node)) {
        return notRepresentable(node, 'not-rational');
      }
      if (
        node.fn === 'unaryPlus' &&
        node.args.length === 1 &&
        node.args[0]
      ) {
        return this.#parseRational(node.args[0], generators, state, depth + 1);
      }
      if (
        node.fn === 'unaryMinus' &&
        node.args.length === 1 &&
        node.args[0]
      ) {
        const operand = this.#parseRational(
          node.args[0],
          generators,
          state,
          depth + 1
        );
        if (isInternalFailure(operand)) {
          return operand;
        }
        const numerator = this.#scalePolynomial(
          operand.value.numerator,
          this.#nodes.constant(-1),
          state
        );
        return isInternalFailure(numerator)
          ? numerator
          : valueResult({
            numerator: numerator.value,
            denominator: operand.value.denominator
          });
      }
      if (node.args.length !== 2 || !node.args[0] || !node.args[1]) {
        return notRepresentable(node, 'not-rational');
      }
      if (
        node.fn === 'add' ||
        node.fn === 'subtract' ||
        node.fn === 'multiply' ||
        node.fn === 'divide'
      ) {
        const left = this.#parseRational(
          node.args[0],
          generators,
          state,
          depth + 1
        );
        if (isInternalFailure(left)) {
          return left;
        }
        const right = this.#parseRational(
          node.args[1],
          generators,
          state,
          depth + 1
        );
        if (isInternalFailure(right)) {
          return right;
        }
        if (node.fn === 'add' || node.fn === 'subtract') {
          const leftNumerator = this.#multiplyPolynomial(
            left.value.numerator,
            right.value.denominator,
            state
          );
          if (isInternalFailure(leftNumerator)) {
            return leftNumerator;
          }
          const rightNumerator = this.#multiplyPolynomial(
            right.value.numerator,
            left.value.denominator,
            state
          );
          if (isInternalFailure(rightNumerator)) {
            return rightNumerator;
          }
          const numerator = this.#addPolynomial(
            leftNumerator.value,
            rightNumerator.value,
            state,
            node.fn === 'subtract'
          );
          if (isInternalFailure(numerator)) {
            return numerator;
          }
          const denominator = this.#multiplyPolynomial(
            left.value.denominator,
            right.value.denominator,
            state
          );
          return isInternalFailure(denominator)
            ? denominator
            : valueResult({
              numerator: numerator.value,
              denominator: denominator.value
            });
        }
        if (node.fn === 'multiply') {
          const numerator = this.#multiplyPolynomial(
            left.value.numerator,
            right.value.numerator,
            state
          );
          if (isInternalFailure(numerator)) {
            return numerator;
          }
          const denominator = this.#multiplyPolynomial(
            left.value.denominator,
            right.value.denominator,
            state
          );
          return isInternalFailure(denominator)
            ? denominator
            : valueResult({
              numerator: numerator.value,
              denominator: denominator.value
            });
        }
        const nonzero = this.#requirePredicates([
          this.#predicates.nonzero(node.args[1])
        ], state);
        if (nonzero) {
          return nonzero;
        }
        if (right.value.numerator.size === 0) {
          return notRepresentable(node.args[1], 'zero-denominator');
        }
        const numerator = this.#multiplyPolynomial(
          left.value.numerator,
          right.value.denominator,
          state
        );
        if (isInternalFailure(numerator)) {
          return numerator;
        }
        const denominator = this.#multiplyPolynomial(
          left.value.denominator,
          right.value.numerator,
          state
        );
        return isInternalFailure(denominator)
          ? denominator
          : valueResult({
            numerator: numerator.value,
            denominator: denominator.value
          });
      }
      if (node.fn === 'pow') {
        if (this.#dependsOnGenerators(node.args[1], generators)) {
          return notRepresentable(node.args[1], 'nonconstant-exponent');
        }
        const evaluation = this.#analyzer.safeEvaluate(node.args[1], state.context);
        if (evaluation.kind !== 'value') {
          return notRepresentable(node.args[1], 'nonconstant-exponent');
        }
        const exponent = this.#asSafeInteger(node.args[1], state.context);
        if (exponent === null) {
          return notRepresentable(node.args[1], 'nonintegral-exponent');
        }
        const base = this.#parseRational(
          node.args[0],
          generators,
          state,
          depth + 1
        );
        if (isInternalFailure(base)) {
          return base;
        }
        if (exponent < 0) {
          const nonzero = this.#requirePredicates([
            this.#predicates.nonzero(node.args[0])
          ], state);
          if (nonzero) {
            return nonzero;
          }
        }
        const power = Math.abs(exponent);
        const numeratorBase = exponent < 0
          ? base.value.denominator
          : base.value.numerator;
        const denominatorBase = exponent < 0
          ? base.value.numerator
          : base.value.denominator;
        if (exponent < 0 && denominatorBase.size === 0) {
          return notRepresentable(node.args[0], 'zero-denominator');
        }
        const numerator = this.#powerPolynomial(
          numeratorBase,
          power,
          state,
          generators.nodes.length
        );
        if (isInternalFailure(numerator)) {
          return numerator;
        }
        const denominator = this.#powerPolynomial(
          denominatorBase,
          power,
          state,
          generators.nodes.length
        );
        return isInternalFailure(denominator)
          ? denominator
          : valueResult({
            numerator: numerator.value,
            denominator: denominator.value
          });
      }
      return notRepresentable(node, 'not-rational');
    } finally {
      this.#leave(node, state);
    }
  }

  #onePolynomial(generatorCount: number): PolynomialData {
    const exponents = Object.freeze(Array.from({length: generatorCount}, () => 0));
    return new Map([[exponentKey(exponents), {
      exponents,
      coefficient: this.#nodes.constant(1)
    }]]);
  }

  #createRationalView(
    source: MathNode,
    rational: RationalData,
    generators: GeneratorSet,
    state: WorkingState
  ): AlgebraViewResult<RationalFunctionView> {
    if (rational.denominator.size === 0) {
      return notRepresentable(source, 'zero-denominator');
    }
    const numeratorResult = this.#createPolynomialView(
      source,
      rational.numerator,
      generators,
      state
    );
    if (isAlgebraFailure(numeratorResult)) {
      return numeratorResult;
    }
    const denominatorResult = this.#createPolynomialView(
      source,
      rational.denominator,
      generators,
      state
    );
    if (isAlgebraFailure(denominatorResult)) {
      return denominatorResult;
    }
    const denominatorNode = denominatorResult.view.rebuild();
    let rebuilt: InternalResult<MathNode>;
    if (this.#constantEquals(denominatorNode, 1, state.context)) {
      rebuilt = valueResult(numeratorResult.view.rebuild());
    } else {
      const required = this.#requirePredicates([
        this.#predicates.nonzero(denominatorNode)
      ], state);
      if (required) {
        return required;
      }
      rebuilt = this.#divide(
        numeratorResult.view.rebuild(),
        denominatorNode,
        state
      );
    }
    if (isInternalFailure(rebuilt)) {
      return rebuilt;
    }
    const view: RationalFunctionView = Object.freeze({
      kind: 'rational-function',
      source,
      generators: generators.nodes,
      numerator: numeratorResult.view,
      denominator: denominatorResult.view,
      requirements: freezeRequirements(state.requirements.values()),
      rebuild: () => rebuilt.value
    });
    return viewSuccess(view);
  }
}
