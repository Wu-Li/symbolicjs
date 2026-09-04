import {
  isConstantNode,
  isFunctionNode,
  isOperatorNode,
  isParenthesisNode,
  isSymbolNode
} from 'mathjs';
import type {
  FunctionNode,
  MathNode,
  OperatorNode,
  OperatorNodeFn,
  OperatorNodeOp
} from 'mathjs';
import type {EqualityNode} from '../../types.js';
import {DefinednessAnalyzer} from '../definedness.js';
import {MathAdapter} from '../math-adapter.js';
import {NodeBuilder} from '../node-builder.js';
import type {
  OperationContext,
  OperationLimitExceeded
} from '../operation-context.js';
import {
  predicateKey,
  PredicateFactory
} from '../predicate.js';
import type {SymbolicPredicate} from '../predicate.js';
import {PredicateEngine} from '../semantic-engine.js';
import {StructuralEngine} from '../structure.js';
import type {
  CanonicalizationProfile,
  CanonicalizationResult,
  CanonicalizationRule,
  CanonicalizationTraceStep,
  NormalizedCanonicalizationOptions
} from './types.js';

type AnyOperatorNode = OperatorNode<OperatorNodeOp, OperatorNodeFn, MathNode[]>;
type AnyFunctionNode = FunctionNode<MathNode, MathNode[]>;

interface Permission {
  readonly allowed: boolean;
  readonly requirements: readonly SymbolicPredicate[];
}

interface MutableCanonicalizationState {
  readonly originalKey: string;
  readonly requirements: Map<string, SymbolicPredicate>;
  readonly trace: CanonicalizationTraceStep[];
  readonly active: WeakSet<object>;
  visited: number;
  limit?: OperationLimitExceeded;
}

const FOLDABLE_OPERATOR_SEMANTICS = new Set([
  'addition',
  'subtraction',
  'negation',
  'multiplication',
  'division',
  'power'
]);

const FOLDABLE_FUNCTION_SEMANTICS = new Set([
  'absolute',
  'nth-root',
  'square-root'
]);

function freezeRequirements(
  requirements: Iterable<SymbolicPredicate>
): readonly SymbolicPredicate[] {
  return Object.freeze([...requirements].sort((left, right) =>
    predicateKey(left).localeCompare(predicateKey(right))
  ));
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function validateProfile(profile: CanonicalizationProfile): CanonicalizationProfile {
  switch (profile) {
    case 'structural':
    case 'scalar':
    case 'real-algebraic':
    case 'complex-safe':
    case 'presentation':
      return profile;
  }
  throw new TypeError('Unknown canonicalization profile');
}

export function normalizeCanonicalizationOptions(
  options: Partial<NormalizedCanonicalizationOptions> = {}
): NormalizedCanonicalizationOptions {
  return Object.freeze({
    profile: validateProfile(options.profile ?? 'structural'),
    maximumPasses: positiveSafeInteger(
      options.maximumPasses ?? 8,
      'maximumPasses'
    ),
    maximumNodes: positiveSafeInteger(
      options.maximumNodes ?? 100_000,
      'maximumNodes'
    ),
    maximumSteps: positiveSafeInteger(
      options.maximumSteps ?? 10_000,
      'maximumSteps'
    )
  });
}

/**
 * Deterministic, assumption-aware canonicalization over MathJS nodes.
 *
 * The engine deliberately avoids general distribution and the permissive MathJS
 * simplifier. Every semantic rewrite is either proven in the supplied operation
 * context or returned with explicit requirements in conditional mode.
 */
export class CanonicalizationEngine {
  readonly #math: MathAdapter;
  readonly #nodes: NodeBuilder;
  readonly #predicates: PredicateFactory;
  readonly #semantics: PredicateEngine;
  readonly #definedness: DefinednessAnalyzer;
  readonly #structure: StructuralEngine;

  constructor(
    math: MathAdapter,
    nodes: NodeBuilder,
    predicates: PredicateFactory,
    semantics: PredicateEngine,
    definedness: DefinednessAnalyzer,
    structure: StructuralEngine
  ) {
    this.#math = math;
    this.#nodes = nodes;
    this.#predicates = predicates;
    this.#semantics = semantics;
    this.#definedness = definedness;
    this.#structure = structure;
    Object.freeze(this);
  }

  canonicalize(
    node: MathNode,
    context: OperationContext,
    options: Partial<NormalizedCanonicalizationOptions> = {}
  ): CanonicalizationResult {
    if (!this.#math.isNode(node)) {
      throw new TypeError('MathJS node expected for canonicalization');
    }
    const normalized = normalizeCanonicalizationOptions(options);
    const state: MutableCanonicalizationState = {
      originalKey: this.#structure.key(node, {parentheses: 'preserve'}),
      requirements: new Map(),
      trace: [],
      active: new WeakSet(),
      visited: 0
    };

    let expression = node;
    let stable = false;
    for (let pass = 1; pass <= normalized.maximumPasses; pass += 1) {
      state.visited = 0;
      const beforeKey = this.#structure.key(expression, {parentheses: 'preserve'});
      const next = this.#visit(expression, context, normalized, state);
      expression = next;
      if (state.limit) {
        break;
      }
      try {
        this.#structure.analyze(expression, {
          maximumNodes: normalized.maximumNodes,
          maximumDepth: normalized.maximumNodes,
          parentheses: 'preserve'
        });
      } catch (error) {
        if (error instanceof RangeError) {
          state.limit = Object.freeze({
            kind: 'limit',
            limit: 'canonicalNodes',
            used: normalized.maximumNodes + 1,
            maximum: normalized.maximumNodes
          });
          break;
        }
        throw error;
      }
      const afterKey = this.#structure.key(expression, {parentheses: 'preserve'});
      if (beforeKey === afterKey) {
        stable = true;
        break;
      }
      if (pass === normalized.maximumPasses) {
        state.limit = Object.freeze({
          kind: 'limit',
          limit: 'canonicalPasses',
          used: pass,
          maximum: normalized.maximumPasses
        });
      }
    }

    const result: CanonicalizationResult = {
      expression,
      profile: normalized.profile,
      changed: state.originalKey !== this.#structure.key(expression, {
        parentheses: 'preserve'
      }),
      complete: stable && state.limit === undefined,
      requirements: freezeRequirements(state.requirements.values()),
      trace: Object.freeze([...state.trace])
    };
    return Object.freeze(state.limit ? {...result, limit: state.limit} : result);
  }

  #visit(
    node: MathNode,
    context: OperationContext,
    options: NormalizedCanonicalizationOptions,
    state: MutableCanonicalizationState
  ): MathNode {
    if (state.limit) {
      return node;
    }
    state.visited += 1;
    if (state.visited > options.maximumNodes) {
      state.limit = Object.freeze({
        kind: 'limit',
        limit: 'canonicalNodes',
        used: state.visited,
        maximum: options.maximumNodes
      });
      return node;
    }
    if (state.active.has(node as object)) {
      throw new TypeError('Cyclic MathJS node encountered during canonicalization');
    }
    state.active.add(node as object);
    try {
      if (isParenthesisNode(node)) {
        const content = this.#visit(node.content, context, options, state);
        return this.#apply(
          'remove-parentheses',
          node,
          content,
          [],
          context,
          state
        );
      }
      if (isConstantNode(node)) {
        return this.#normalizeConstant(node, context, state);
      }
      if (this.#isEquality(node)) {
        return this.#normalizeEquality(node, context, options, state);
      }
      if (isOperatorNode(node)) {
        return this.#normalizeOperator(node, context, options, state);
      }
      if (isFunctionNode(node)) {
        return this.#normalizeFunction(node, context, options, state);
      }
      return this.#normalizeGenericNode(node, context, options, state);
    } finally {
      state.active.delete(node as object);
    }
  }

  #normalizeConstant(
    node: import('mathjs').ConstantNode,
    context: OperationContext,
    state: MutableCanonicalizationState
  ): MathNode {
    if (typeof node.value === 'number' && Object.is(node.value, -0)) {
      return this.#apply(
        'normalize-negative-zero',
        node,
        this.#nodes.constant(0),
        [],
        context,
        state
      );
    }
    return node;
  }

  #normalizeEquality(
    node: EqualityNode,
    context: OperationContext,
    options: NormalizedCanonicalizationOptions,
    state: MutableCanonicalizationState
  ): MathNode {
    const lhs = this.#visit(node.lhs, context, options, state);
    const rhs = this.#visit(node.rhs, context, options, state);
    return this.#apply(
      'rebuild-equality',
      node,
      this.#nodes.equality(lhs, rhs),
      [],
      context,
      state
    );
  }

  #normalizeOperator(
    node: AnyOperatorNode,
    context: OperationContext,
    options: NormalizedCanonicalizationOptions,
    state: MutableCanonicalizationState
  ): MathNode {
    const args = node.args.map((argument) =>
      this.#visit(argument, context, options, state)
    );

    if (node.fn === 'unaryPlus' && args[0]) {
      return this.#apply(
        'remove-unary-plus',
        node,
        args[0],
        [],
        context,
        state
      );
    }
    if (node.fn === 'unaryMinus' && args[0]) {
      return this.#normalizeNegation(node, args[0], context, options, state);
    }
    if (node.fn === 'add') {
      return this.#normalizeAddition(node, args, context, options, state);
    }
    if (node.fn === 'subtract' && args[0] && args[1]) {
      return this.#normalizeSubtraction(
        node,
        args[0],
        args[1],
        context,
        options,
        state
      );
    }
    if (node.fn === 'multiply') {
      return this.#normalizeMultiplication(node, args, context, options, state);
    }
    if (node.fn === 'pow' && args[0] && args[1]) {
      return this.#normalizePower(node, args[0], args[1], context, options, state);
    }

    const rebuilt = this.#nodes.operator(node.op, node.fn, args, node.implicit);
    if (options.profile !== 'structural') {
      const folded = this.#foldConstantOperator(rebuilt, context);
      if (folded) {
        return this.#apply(
          'fold-constant-operator',
          node,
          folded,
          [],
          context,
          state
        );
      }
    }
    return this.#apply(
      'rebuild-operator',
      node,
      rebuilt,
      [],
      context,
      state
    );
  }

  #normalizeNegation(
    original: AnyOperatorNode,
    argument: MathNode,
    context: OperationContext,
    options: NormalizedCanonicalizationOptions,
    state: MutableCanonicalizationState
  ): MathNode {
    const rebuilt = this.#nodes.operator('-', 'unaryMinus', [argument]);
    const folded = this.#foldConstantOperator(rebuilt, context);
    if (folded) {
      return this.#apply(
        'fold-unary-minus',
        original,
        folded,
        [],
        context,
        state
      );
    }

    if (options.profile === 'structural') {
      return this.#apply(
        'rebuild-operator',
        original,
        rebuilt,
        [],
        context,
        state
      );
    }

    const permission = this.#permission(
      [this.#predicates.scalar(argument)],
      context
    );
    if (!permission.allowed) {
      return this.#apply(
        'rebuild-operator',
        original,
        rebuilt,
        [],
        context,
        state
      );
    }

    if (isOperatorNode(argument) && argument.fn === 'unaryMinus' && argument.args[0]) {
      return this.#apply(
        'cancel-double-negation',
        original,
        argument.args[0],
        permission.requirements,
        context,
        state
      );
    }

    if (isOperatorNode(argument) && argument.fn === 'multiply') {
      const multiplied = this.#normalizeMultiplication(
        rebuilt as AnyOperatorNode,
        [this.#nodes.constant(-1), ...argument.args],
        context,
        options,
        state
      );
      return this.#apply(
        'fold-unary-minus',
        original,
        multiplied,
        permission.requirements,
        context,
        state
      );
    }

    return this.#apply(
      'rebuild-operator',
      original,
      rebuilt,
      [],
      context,
      state
    );
  }

  #normalizeSubtraction(
    original: AnyOperatorNode,
    left: MathNode,
    right: MathNode,
    context: OperationContext,
    options: NormalizedCanonicalizationOptions,
    state: MutableCanonicalizationState
  ): MathNode {
    const rebuilt = this.#nodes.operator('-', 'subtract', [left, right]);
    if (options.profile === 'structural') {
      return this.#apply(
        'rebuild-operator',
        original,
        rebuilt,
        [],
        context,
        state
      );
    }

    const permission = this.#permission(
      [this.#predicates.scalar(left), this.#predicates.scalar(right)],
      context
    );
    if (!permission.allowed) {
      return this.#apply(
        'rebuild-operator',
        original,
        rebuilt,
        [],
        context,
        state
      );
    }

    const negative = this.#normalizeNegation(
      this.#nodes.operator('-', 'unaryMinus', [right]) as AnyOperatorNode,
      right,
      context,
      options,
      state
    );
    const sum = this.#nodes.operator('+', 'add', [left, negative]);
    const normalized = this.#normalizeAddition(
      sum as AnyOperatorNode,
      [left, negative],
      context,
      options,
      state
    );
    return this.#apply(
      'normalize-subtraction',
      original,
      normalized,
      permission.requirements,
      context,
      state
    );
  }

  #normalizeAddition(
    original: AnyOperatorNode,
    canonicalArgs: readonly MathNode[],
    context: OperationContext,
    options: NormalizedCanonicalizationOptions,
    state: MutableCanonicalizationState
  ): MathNode {
    let terms = [...canonicalArgs];
    let current = this.#buildAssociative('+', 'add', terms, 0);

    if (options.profile === 'structural') {
      return this.#apply(
        'rebuild-operator',
        original,
        current,
        [],
        context,
        state
      );
    }

    const permission = this.#permission(
      terms.map((term) => this.#predicates.scalar(term)),
      context
    );
    if (!permission.allowed) {
      return this.#apply(
        'rebuild-operator',
        original,
        current,
        [],
        context,
        state
      );
    }

    const flattened = this.#flatten('add', terms);
    if (flattened.length !== terms.length || flattened.some((term, index) =>
      term !== terms[index]
    )) {
      terms = flattened;
      current = this.#apply(
        'flatten-addition',
        current,
        this.#buildAssociative('+', 'add', terms, 0),
        permission.requirements,
        context,
        state
      );
    }

    const withoutZeros = terms.filter((term) =>
      this.#semantics.ask(this.#predicates.zero(term), context).truth !== 'proven'
    );
    if (withoutZeros.length !== terms.length) {
      terms = withoutZeros;
      current = this.#apply(
        'remove-additive-zero',
        current,
        this.#buildAssociative('+', 'add', terms, 0),
        permission.requirements,
        context,
        state
      );
    }

    if (terms.length <= 1 || state.limit) {
      return this.#apply(
        'rebuild-operator',
        original,
        current,
        [],
        context,
        state
      );
    }

    const folded = this.#foldConstants('add', terms);
    if (folded) {
      terms = folded;
      current = this.#apply(
        'fold-additive-constants',
        current,
        this.#buildAssociative('+', 'add', terms, 0),
        permission.requirements,
        context,
        state
      );
    }

    const sorted = [...terms].sort((left, right) =>
      this.#structure.compare(left, right, {parentheses: 'transparent'})
    );
    if (sorted.some((term, index) => term !== terms[index])) {
      terms = sorted;
      current = this.#apply(
        'sort-addition',
        current,
        this.#buildAssociative('+', 'add', terms, 0),
        permission.requirements,
        context,
        state
      );
    }

    return this.#apply(
      'rebuild-operator',
      original,
      current,
      [],
      context,
      state
    );
  }

  #normalizeMultiplication(
    original: AnyOperatorNode,
    canonicalArgs: readonly MathNode[],
    context: OperationContext,
    options: NormalizedCanonicalizationOptions,
    state: MutableCanonicalizationState
  ): MathNode {
    let factors = [...canonicalArgs];
    let current = this.#buildAssociative('*', 'multiply', factors, 1);

    if (options.profile === 'structural') {
      return this.#apply(
        'rebuild-operator',
        original,
        current,
        [],
        context,
        state
      );
    }

    const permission = this.#permission(
      factors.map((factor) => this.#predicates.scalar(factor)),
      context
    );
    if (!permission.allowed) {
      return this.#apply(
        'rebuild-operator',
        original,
        current,
        [],
        context,
        state
      );
    }

    const flattened = this.#flatten('multiply', factors);
    if (flattened.length !== factors.length || flattened.some((factor, index) =>
      factor !== factors[index]
    )) {
      factors = flattened;
      current = this.#apply(
        'flatten-multiplication',
        current,
        this.#buildAssociative('*', 'multiply', factors, 1),
        permission.requirements,
        context,
        state
      );
    }

    const withoutOnes = factors.filter((factor) => !this.#constantEquals(factor, 1));
    if (withoutOnes.length !== factors.length) {
      factors = withoutOnes;
      current = this.#apply(
        'remove-multiplicative-one',
        current,
        this.#buildAssociative('*', 'multiply', factors, 1),
        permission.requirements,
        context,
        state
      );
    }

    if (factors.length <= 1 || state.limit) {
      return this.#apply(
        'rebuild-operator',
        original,
        current,
        [],
        context,
        state
      );
    }

    const signed = this.#extractNegatedFactors(factors);
    if (signed) {
      factors = signed;
      current = this.#apply(
        'fold-multiplicative-constants',
        current,
        this.#buildAssociative('*', 'multiply', factors, 1),
        permission.requirements,
        context,
        state
      );
    }

    const folded = this.#foldConstants('multiply', factors);
    if (folded) {
      factors = folded;
      current = this.#apply(
        'fold-multiplicative-constants',
        current,
        this.#buildAssociative('*', 'multiply', factors, 1),
        permission.requirements,
        context,
        state
      );
    }

    const zero = factors.find((factor) =>
      this.#semantics.ask(this.#predicates.zero(factor), context).truth === 'proven'
    );
    if (zero) {
      const others = factors.filter((factor) => factor !== zero);
      const defined = this.#definedPermission(others, context);
      if (defined.allowed) {
        return this.#apply(
          'apply-zero-annihilator',
          original,
          this.#nodes.constant(0),
          [...permission.requirements, ...defined.requirements],
          context,
          state
        );
      }
    }

    const sorted = [...factors].sort((left, right) =>
      this.#structure.compare(left, right, {parentheses: 'transparent'})
    );
    if (sorted.some((factor, index) => factor !== factors[index])) {
      factors = sorted;
      current = this.#apply(
        'sort-multiplication',
        current,
        this.#buildAssociative('*', 'multiply', factors, 1),
        permission.requirements,
        context,
        state
      );
    }

    if (
      factors.length === 2 &&
      this.#constantEquals(factors[0]!, -1) &&
      options.profile === 'presentation'
    ) {
      current = this.#apply(
        'fold-unary-minus',
        current,
        this.#nodes.operator('-', 'unaryMinus', [factors[1]!]),
        permission.requirements,
        context,
        state
      );
    }

    return this.#apply(
      'rebuild-operator',
      original,
      current,
      [],
      context,
      state
    );
  }

  #normalizePower(
    original: AnyOperatorNode,
    base: MathNode,
    exponent: MathNode,
    context: OperationContext,
    options: NormalizedCanonicalizationOptions,
    state: MutableCanonicalizationState
  ): MathNode {
    const rebuilt = this.#nodes.operator('^', 'pow', [base, exponent]);
    if (options.profile === 'structural') {
      return this.#apply(
        'rebuild-operator',
        original,
        rebuilt,
        [],
        context,
        state
      );
    }

    if (this.#constantEquals(exponent, 1)) {
      const permission = this.#permission(
        [this.#predicates.scalar(base)],
        context
      );
      if (permission.allowed) {
        return this.#apply(
          'simplify-power-one',
          original,
          base,
          permission.requirements,
          context,
          state
        );
      }
    }
    if (this.#constantEquals(exponent, 0)) {
      const permission = this.#permission(
        [this.#predicates.nonzero(base)],
        context
      );
      if (permission.allowed) {
        return this.#apply(
          'simplify-power-zero',
          original,
          this.#nodes.constant(1),
          permission.requirements,
          context,
          state
        );
      }
      return this.#apply(
        'rebuild-operator',
        original,
        rebuilt,
        [],
        context,
        state
      );
    }
    if (this.#constantEquals(base, 1)) {
      const scalar = this.#permission(
        [this.#predicates.scalar(exponent)],
        context
      );
      const defined = this.#definedPermission([exponent], context);
      if (scalar.allowed && defined.allowed) {
        return this.#apply(
          'simplify-one-power',
          original,
          this.#nodes.constant(1),
          [...scalar.requirements, ...defined.requirements],
          context,
          state
        );
      }
    }

    const folded = this.#foldConstantOperator(rebuilt, context);
    if (folded) {
      return this.#apply(
        this.#constantEquals(base, 0)
          ? 'simplify-zero-power'
          : 'fold-constant-operator',
        original,
        folded,
        [],
        context,
        state
      );
    }

    return this.#apply(
      'rebuild-operator',
      original,
      rebuilt,
      [],
      context,
      state
    );
  }

  #normalizeFunction(
    node: AnyFunctionNode,
    context: OperationContext,
    options: NormalizedCanonicalizationOptions,
    state: MutableCanonicalizationState
  ): MathNode {
    const fn = this.#math.isNode(node.fn)
      ? this.#visit(node.fn, context, options, state)
      : node.fn;
    const args = node.args.map((argument) =>
      this.#visit(argument, context, options, state)
    );
    const rebuilt = new this.#math.FunctionNode(fn, [...args]);

    if (
      options.profile === 'real-algebraic' &&
      isSymbolNode(fn) &&
      (fn.name === 'sqrt' || fn.name === 'nthRoot')
    ) {
      const normalized = this.#normalizeRealSquareRoot(
        node,
        fn.name,
        args,
        context,
        state
      );
      if (normalized) {
        return normalized;
      }
    }

    if (options.profile !== 'structural') {
      const folded = this.#foldConstantFunction(rebuilt, context);
      if (folded) {
        return this.#apply(
          'fold-constant-function',
          node,
          folded,
          [],
          context,
          state
        );
      }
    }

    return this.#apply(
      'rebuild-function',
      node,
      rebuilt,
      [],
      context,
      state
    );
  }

  #normalizeRealSquareRoot(
    original: AnyFunctionNode,
    name: string,
    args: readonly MathNode[],
    context: OperationContext,
    state: MutableCanonicalizationState
  ): MathNode | null {
    const argument = args[0];
    if (!argument) {
      return null;
    }
    if (name === 'nthRoot' && !this.#constantEquals(args[1]!, 2)) {
      return null;
    }
    if (
      !isOperatorNode(argument) ||
      argument.fn !== 'pow' ||
      !argument.args[0] ||
      !argument.args[1] ||
      !this.#constantEquals(argument.args[1], 2)
    ) {
      return null;
    }

    const base = argument.args[0];
    const permission = this.#permission([this.#predicates.real(base)], context);
    if (!permission.allowed) {
      return null;
    }
    const nonnegative = this.#semantics.ask(
      this.#predicates.nonnegative(base),
      context
    );
    if (nonnegative.truth === 'proven') {
      return this.#apply(
        'normalize-real-square-root',
        original,
        base,
        permission.requirements,
        context,
        state
      );
    }
    const nonpositive = this.#semantics.ask(
      this.#predicates.nonpositive(base),
      context
    );
    if (nonpositive.truth === 'proven') {
      return this.#apply(
        'normalize-real-square-root',
        original,
        this.#nodes.operator('-', 'unaryMinus', [base]),
        permission.requirements,
        context,
        state
      );
    }
    return this.#apply(
      'normalize-real-square-root',
      original,
      this.#nodes.call('abs', [base]),
      permission.requirements,
      context,
      state
    );
  }

  #normalizeGenericNode(
    node: MathNode,
    context: OperationContext,
    options: NormalizedCanonicalizationOptions,
    state: MutableCanonicalizationState
  ): MathNode {
    const traceLength = state.trace.length;
    const requirements = new Map(state.requirements);
    try {
      const rebuilt = node.map((child) =>
        this.#visit(child, context, options, state)
      );
      return this.#apply(
        'rebuild-node',
        node,
        rebuilt,
        [],
        context,
        state
      );
    } catch (error) {
      if (
        error instanceof TypeError &&
        error.message.includes('Cyclic MathJS node')
      ) {
        throw error;
      }
      state.trace.splice(traceLength);
      state.requirements.clear();
      for (const [key, requirement] of requirements) {
        state.requirements.set(key, requirement);
      }
      return node;
    }
  }

  #flatten(
    functionName: 'add' | 'multiply',
    nodes: readonly MathNode[]
  ): MathNode[] {
    const flattened: MathNode[] = [];
    const visit = (node: MathNode): void => {
      if (isOperatorNode(node) && node.fn === functionName) {
        for (const argument of node.args) {
          visit(argument);
        }
      } else {
        flattened.push(node);
      }
    };
    for (const node of nodes) {
      visit(node);
    }
    return flattened;
  }

  #extractNegatedFactors(factors: readonly MathNode[]): MathNode[] | null {
    let signs = 0;
    const result: MathNode[] = [];
    for (const factor of factors) {
      if (isOperatorNode(factor) && factor.fn === 'unaryMinus' && factor.args[0]) {
        signs += 1;
        result.push(factor.args[0]);
      } else {
        result.push(factor);
      }
    }
    if (signs === 0) {
      return null;
    }
    if (signs % 2 === 1) {
      result.unshift(this.#nodes.constant(-1));
    }
    return result;
  }

  #foldConstants(
    functionName: 'add' | 'multiply',
    nodes: readonly MathNode[]
  ): MathNode[] | null {
    const constants: import('mathjs').ConstantNode[] = [];
    const others: MathNode[] = [];
    for (const node of nodes) {
      if (isConstantNode(node) && this.#isExactValue(node.value)) {
        constants.push(node);
      } else {
        others.push(node);
      }
    }
    if (constants.length < 2) {
      return null;
    }

    let value: unknown = constants[0]!.value;
    for (const constant of constants.slice(1)) {
      const result = this.#invoke(functionName, [value, constant.value]);
      if (!result.succeeded || !this.#isExactValue(result.value)) {
        return null;
      }
      value = result.value;
    }
    const folded = this.#normalizeConstantValue(value);
    if (functionName === 'add' && this.#valueEquals(folded, 0) && others.length > 0) {
      return others;
    }
    if (
      functionName === 'multiply' &&
      this.#valueEquals(folded, 1) &&
      others.length > 0
    ) {
      return others;
    }
    return [this.#nodes.constant(folded), ...others];
  }

  #foldConstantOperator(
    node: MathNode,
    context: OperationContext
  ): MathNode | null {
    if (!isOperatorNode(node)) {
      return null;
    }
    const semantic = context.registry.getOperator(node.fn)?.semantic ?? 'opaque';
    if (!FOLDABLE_OPERATOR_SEMANTICS.has(semantic)) {
      return null;
    }
    if (!node.args.every((argument) =>
      isConstantNode(argument) && this.#isExactValue(argument.value)
    )) {
      return null;
    }
    if (node.fn === 'pow') {
      const base = node.args[0];
      const exponent = node.args[1];
      if (!base || !exponent || !this.#isIntegerConstant(exponent)) {
        return null;
      }
      if (this.#constantEquals(base, 0) && this.#constantEquals(exponent, 0)) {
        return null;
      }
    }
    const defined = this.#definedPermission([node], context);
    if (!defined.allowed || defined.requirements.length > 0) {
      return null;
    }
    const result = this.#invoke(node.fn, node.args.map((argument) =>
      (argument as import('mathjs').ConstantNode).value
    ));
    if (!result.succeeded || !this.#isExactValue(result.value)) {
      return null;
    }
    if (node.fn === 'divide' && !this.#divisionIsExact(
      node.args[0] as import('mathjs').ConstantNode,
      node.args[1] as import('mathjs').ConstantNode,
      result.value
    )) {
      return null;
    }
    return this.#nodes.constant(this.#normalizeConstantValue(result.value));
  }

  #foldConstantFunction(
    node: AnyFunctionNode,
    context: OperationContext
  ): MathNode | null {
    if (!isSymbolNode(node.fn)) {
      return null;
    }
    const semantic = context.registry.getFunction(node.fn.name)?.semantic ?? 'opaque';
    if (!FOLDABLE_FUNCTION_SEMANTICS.has(semantic)) {
      return null;
    }
    if (!node.args.every((argument) =>
      isConstantNode(argument) && this.#isExactValue(argument.value)
    )) {
      return null;
    }
    const defined = this.#definedPermission([node], context);
    if (!defined.allowed || defined.requirements.length > 0) {
      return null;
    }
    const result = this.#invoke(node.fn.name, node.args.map((argument) =>
      (argument as import('mathjs').ConstantNode).value
    ));
    if (!result.succeeded || !this.#isExactValue(result.value)) {
      return null;
    }
    if (
      (semantic === 'square-root' || semantic === 'nth-root') &&
      !this.#rootIsExact(node, result.value)
    ) {
      return null;
    }
    return this.#nodes.constant(this.#normalizeConstantValue(result.value));
  }

  #divisionIsExact(
    numerator: import('mathjs').ConstantNode,
    denominator: import('mathjs').ConstantNode,
    quotient: unknown
  ): boolean {
    if (typeof quotient === 'number') {
      return Number.isSafeInteger(quotient);
    }
    if (typeof quotient === 'bigint') {
      return true;
    }
    if (this.#guard('isFraction', quotient)) {
      return true;
    }
    if (this.#guard('isBigNumber', quotient)) {
      const candidate = quotient as {
        times?: (value: unknown) => unknown;
        eq?: (value: unknown) => boolean;
      };
      if (typeof candidate.times === 'function') {
        const reconstructed = candidate.times(denominator.value);
        if (
          reconstructed &&
          typeof reconstructed === 'object' &&
          'eq' in reconstructed &&
          typeof reconstructed.eq === 'function'
        ) {
          return reconstructed.eq(numerator.value);
        }
      }
    }
    return false;
  }

  #rootIsExact(node: AnyFunctionNode, root: unknown): boolean {
    const argument = node.args[0];
    if (!argument || !isConstantNode(argument)) {
      return false;
    }
    const degreeNode = node.args[1];
    const degree = degreeNode && isConstantNode(degreeNode)
      ? this.#asInteger(degreeNode.value)
      : 2;
    if (degree === null) {
      return false;
    }
    const powered = this.#invoke('pow', [root, degree]);
    return powered.succeeded && this.#strictValueEquals(
      powered.value,
      argument.value
    );
  }

  #definedPermission(
    nodes: readonly MathNode[],
    context: OperationContext
  ): Permission {
    const requirements: SymbolicPredicate[] = [];
    for (const node of nodes) {
      requirements.push(...this.#definedness.requirements(node, {
        domain: context.domain,
        includeLeafDefinedness: true
      }));
    }
    return this.#permission(requirements, context);
  }

  #permission(
    predicates: readonly SymbolicPredicate[],
    context: OperationContext
  ): Permission {
    const requirements = new Map<string, SymbolicPredicate>();
    for (const predicate of predicates) {
      const result = this.#semantics.require(predicate, context);
      if (result.kind === 'rejected') {
        return Object.freeze({allowed: false, requirements: Object.freeze([])});
      }
      if (result.kind === 'conditional') {
        for (const requirement of result.requirements) {
          requirements.set(predicateKey(requirement), requirement);
        }
      }
    }
    return Object.freeze({
      allowed: true,
      requirements: freezeRequirements(requirements.values())
    });
  }

  #apply(
    rule: CanonicalizationRule,
    before: MathNode,
    after: MathNode,
    requirements: readonly SymbolicPredicate[],
    context: OperationContext,
    state: MutableCanonicalizationState
  ): MathNode {
    if (state.limit) {
      return before;
    }
    const beforeKey = this.#structure.key(before, {parentheses: 'preserve'});
    const afterKey = this.#structure.key(after, {parentheses: 'preserve'});
    if (beforeKey === afterKey) {
      return before;
    }
    const limit = context.consume('canonicalSteps');
    if (limit) {
      state.limit = limit;
      return before;
    }
    for (const requirement of requirements) {
      state.requirements.set(predicateKey(requirement), requirement);
    }
    const step = Object.freeze({
      rule,
      before: this.#structure.fingerprint(before, {parentheses: 'preserve'}),
      after: this.#structure.fingerprint(after, {parentheses: 'preserve'}),
      requirements: freezeRequirements(requirements)
    });
    state.trace.push(step);
    context.trace({stage: 'canonicalize', rule, outcome: step.after});
    return after;
  }

  #buildAssociative(
    operator: '+' | '*',
    functionName: 'add' | 'multiply',
    nodes: readonly MathNode[],
    identity: 0 | 1
  ): MathNode {
    if (nodes.length === 0) {
      return this.#nodes.constant(identity);
    }
    if (nodes.length === 1) {
      return nodes[0]!;
    }
    let result = this.#nodes.operator(operator, functionName, [nodes[0]!, nodes[1]!]);
    for (const node of nodes.slice(2)) {
      result = this.#nodes.operator(operator, functionName, [result, node]);
    }
    return result;
  }

  #invoke(
    name: string,
    args: readonly unknown[]
  ): {readonly succeeded: true; readonly value: unknown} |
    {readonly succeeded: false} {
    const fn = this.#math.lookup(name);
    if (typeof fn !== 'function') {
      return Object.freeze({succeeded: false});
    }
    try {
      return Object.freeze({
        succeeded: true,
        value: (fn as (...values: unknown[]) => unknown)(...args)
      });
    } catch {
      return Object.freeze({succeeded: false});
    }
  }

  #constantEquals(node: MathNode | undefined, expected: number): boolean {
    return Boolean(
      node &&
      isConstantNode(node) &&
      this.#valueEquals(node.value, expected)
    );
  }

  #valueEquals(value: unknown, expected: number): boolean {
    const equal = this.#math.lookup('equal');
    if (typeof equal === 'function') {
      try {
        return (equal as (left: unknown, right: unknown) => unknown)(
          value,
          expected
        ) === true;
      } catch {
        // Fall through to primitive/valueOf comparisons.
      }
    }
    if (typeof value === 'number') {
      return Object.is(value, expected) || value === expected;
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

  #strictValueEquals(left: unknown, right: unknown): boolean {
    if (typeof left === 'number' && typeof right === 'number') {
      return Object.is(left, right) || left === right;
    }
    if (typeof left === 'bigint' && typeof right === 'bigint') {
      return left === right;
    }
    if (
      left &&
      typeof left === 'object' &&
      'eq' in left &&
      typeof left.eq === 'function'
    ) {
      try {
        return left.eq(right);
      } catch {
        return false;
      }
    }
    if (this.#guard('isFraction', left) && this.#guard('isFraction', right)) {
      const lhs = left as {s: number; n: number; d: number};
      const rhs = right as {s: number; n: number; d: number};
      return lhs.s === rhs.s && lhs.n === rhs.n && lhs.d === rhs.d;
    }
    if (this.#guard('isComplex', left)) {
      const lhs = left as {re: number; im: number};
      if (this.#guard('isComplex', right)) {
        const rhs = right as {re: number; im: number};
        return Object.is(lhs.re, rhs.re) && Object.is(lhs.im, rhs.im);
      }
      if (typeof right === 'number') {
        return lhs.im === 0 && (Object.is(lhs.re, right) || lhs.re === right);
      }
    }
    if (this.#guard('isComplex', right) && typeof left === 'number') {
      const rhs = right as {re: number; im: number};
      return rhs.im === 0 && (Object.is(left, rhs.re) || left === rhs.re);
    }
    return Object.is(left, right);
  }

  #isIntegerConstant(node: MathNode): boolean {
    return isConstantNode(node) && this.#asInteger(node.value) !== null;
  }

  #asInteger(value: unknown): number | null {
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
    return null;
  }

  #isExactValue(value: unknown): boolean {
    if (typeof value === 'number') {
      return Number.isFinite(value) && Number.isSafeInteger(value);
    }
    if (typeof value === 'bigint') {
      return true;
    }
    if (this.#guard('isFraction', value) || this.#guard('isBigNumber', value)) {
      return true;
    }
    if (this.#guard('isComplex', value)) {
      const complex = value as {re: number; im: number};
      return Number.isSafeInteger(complex.re) && Number.isSafeInteger(complex.im);
    }
    return false;
  }

  #normalizeConstantValue(value: unknown): unknown {
    return typeof value === 'number' && Object.is(value, -0) ? 0 : value;
  }

  #guard(name: string, value: unknown): boolean {
    const guard = this.#math.lookup(name);
    if (typeof guard === 'function') {
      try {
        if (Boolean((guard as (candidate: unknown) => unknown)(value))) {
          return true;
        }
      } catch {
        // Fall through to the configured MathJS marker contract.
      }
    }
    if (!value || typeof value !== 'object') {
      return false;
    }
    const prototype = Object.getPrototypeOf(value) as Record<string, unknown> | null;
    return prototype?.[name] === true;
  }

  #isEquality(node: MathNode): node is EqualityNode {
    return node.type === 'EqualityNode' &&
      'lhs' in node &&
      'rhs' in node &&
      this.#math.isNode((node as EqualityNode).lhs) &&
      this.#math.isNode((node as EqualityNode).rhs);
  }
}
