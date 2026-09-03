import {
  isFunctionNode,
  isSymbolNode
} from 'mathjs';
import type {MathJsInstance, MathNode} from 'mathjs';
import {nodeSymbols} from './analysis.js';
import {SolverContext} from './budget.js';
import {customFactory} from './custom-factory.js';
import type {SymbolicKernel} from './kernel.js';
import {allocateIntegerParameter} from './parametric.js';
import {
  limitResult,
  parametricResult,
  unsupportedResult
} from './solve-types.js';
import type {
  Condition,
  FiniteSolutions,
  LimitResult,
  ParametricFamily,
  PartialResult,
  Solution,
  SolveOptions,
  SolveResult
} from './solve-types.js';
import type {EqualityNode, EqualityNodeConstructor} from './types.js';

export interface CircularFunctionDefinition {
  readonly inverse: string;
  readonly periodMultiplier: number;
  readonly bounded: boolean;
  readonly parity: 'odd' | 'even' | 'neither';
}

export const CIRCULAR_FUNCTIONS: Readonly<Record<string, CircularFunctionDefinition>> =
  Object.freeze({
    sin: Object.freeze({inverse: 'asin', periodMultiplier: 2, bounded: true, parity: 'odd'}),
    cos: Object.freeze({inverse: 'acos', periodMultiplier: 2, bounded: true, parity: 'even'}),
    tan: Object.freeze({inverse: 'atan', periodMultiplier: 1, bounded: false, parity: 'odd'}),
    sec: Object.freeze({inverse: 'acos', periodMultiplier: 2, bounded: false, parity: 'even'}),
    csc: Object.freeze({inverse: 'asin', periodMultiplier: 2, bounded: false, parity: 'odd'}),
    cot: Object.freeze({inverse: 'atan', periodMultiplier: 1, bounded: false, parity: 'odd'})
  });

const INVERSE_FUNCTIONS = new Set(['asin', 'acos', 'atan']);

interface TrigonometricDependencies {
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
  symbolicKernel: SymbolicKernel;
}

interface PeriodicBranch {
  readonly value: MathNode;
  readonly conditions: readonly Condition[];
  readonly inverseFunction: string;
  readonly period: MathNode;
  readonly branch: string;
}

function isSolutionArray(
  value: readonly Solution[] | LimitResult | null
): value is readonly Solution[] {
  return Array.isArray(value);
}

function targetOccurrences(node: MathNode, target: string): number {
  let count = 0;
  node.traverse((candidate) => {
    if (isSymbolNode(candidate) && candidate.name === target) {
      count += 1;
    }
  });
  return count;
}

export class TrigonometricEngine {
  readonly #dependencies: TrigonometricDependencies;

  constructor(dependencies: TrigonometricDependencies) {
    this.#dependencies = dependencies;
  }

  #constant(value: number): MathNode {
    return new this.#dependencies.ConstantNode(value);
  }

  #symbol(name: string): MathNode {
    return new this.#dependencies.SymbolNode(name);
  }

  #operator(op: string, fn: string, left: MathNode, right?: MathNode): MathNode {
    const args: MathNode[] = right === undefined ? [left] : [left, right];
    return new this.#dependencies.OperatorNode(
      op as never,
      fn as never,
      args
    );
  }

  #function(name: string, argument: MathNode): MathNode {
    return new this.#dependencies.FunctionNode(
      new this.#dependencies.SymbolNode(name),
      [argument]
    );
  }

  #add(left: MathNode, right: MathNode): MathNode {
    return this.#operator('+', 'add', left, right);
  }

  #subtract(left: MathNode, right: MathNode): MathNode {
    return this.#operator('-', 'subtract', left, right);
  }

  #multiply(left: MathNode, right: MathNode): MathNode {
    return this.#operator('*', 'multiply', left, right);
  }

  #divide(left: MathNode, right: MathNode): MathNode {
    return this.#operator('/', 'divide', left, right);
  }

  #negate(value: MathNode): MathNode {
    return this.#operator('-', 'unaryMinus', value);
  }

  #pow(left: MathNode, right: number): MathNode {
    return this.#operator('^', 'pow', left, this.#constant(right));
  }

  #condition(kind: Condition['kind'], expression: MathNode): Condition {
    return this.#dependencies.symbolicKernel.condition(kind, expression);
  }

  #numericValue(node: MathNode): number | null {
    if (nodeSymbols(node).length > 0) {
      return null;
    }
    try {
      const value = node.compile().evaluate();
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
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
    } catch {
      return null;
    }
    return null;
  }

  #period(multiplier: number): MathNode {
    return multiplier === 1
      ? this.#symbol('pi')
      : this.#multiply(this.#constant(multiplier), this.#symbol('pi'));
  }

  #withPeriod(offset: MathNode, period: MathNode, parameter: string): MathNode {
    return this.#dependencies.symbolicKernel.simplify(this.#add(
      offset,
      this.#multiply(period, this.#symbol(parameter))
    ));
  }

  #rangeCondition(value: MathNode): Condition {
    return this.#condition('nonnegative', this.#subtract(
      this.#constant(1),
      this.#pow(value, 2)
    ));
  }

  #primaryBranches(
    name: 'sin' | 'cos' | 'tan',
    value: MathNode,
    parameter: string,
    inheritedConditions: readonly Condition[] = []
  ): readonly PeriodicBranch[] {
    const numeric = this.#numericValue(value);
    const tolerance = 1e-12;
    const period = this.#period(name === 'tan' ? 1 : 2);
    const conditions = name === 'tan'
      ? [...inheritedConditions]
      : [...inheritedConditions, this.#rangeCondition(value)];
    if (numeric !== null && name !== 'tan' && (numeric < -1 || numeric > 1)) {
      return [];
    }

    if (name === 'sin') {
      if (numeric !== null && Math.abs(numeric) <= tolerance) {
        const compactPeriod = this.#period(1);
        return [{
          value: this.#withPeriod(this.#constant(0), compactPeriod, parameter),
          conditions,
          inverseFunction: 'asin',
          period: compactPeriod,
          branch: 'zero'
        }];
      }
      if (numeric !== null && Math.abs(numeric - 1) <= tolerance) {
        return [{
          value: this.#withPeriod(this.#divide(this.#symbol('pi'), this.#constant(2)), period, parameter),
          conditions,
          inverseFunction: 'asin',
          period,
          branch: 'maximum'
        }];
      }
      if (numeric !== null && Math.abs(numeric + 1) <= tolerance) {
        return [{
          value: this.#withPeriod(this.#negate(
            this.#divide(this.#symbol('pi'), this.#constant(2))
          ), period, parameter),
          conditions,
          inverseFunction: 'asin',
          period,
          branch: 'minimum'
        }];
      }
      const principal = this.#function('asin', value);
      return [
        {
          value: this.#withPeriod(principal, period, parameter),
          conditions,
          inverseFunction: 'asin',
          period,
          branch: 'principal'
        },
        {
          value: this.#withPeriod(
            this.#subtract(this.#symbol('pi'), principal),
            period,
            parameter
          ),
          conditions,
          inverseFunction: 'asin',
          period,
          branch: 'supplementary'
        }
      ];
    }

    if (name === 'cos') {
      if (numeric !== null && Math.abs(numeric) <= tolerance) {
        const compactPeriod = this.#period(1);
        return [{
          value: this.#withPeriod(
            this.#divide(this.#symbol('pi'), this.#constant(2)),
            compactPeriod,
            parameter
          ),
          conditions,
          inverseFunction: 'acos',
          period: compactPeriod,
          branch: 'zero'
        }];
      }
      if (numeric !== null && Math.abs(numeric - 1) <= tolerance) {
        return [{
          value: this.#withPeriod(this.#constant(0), period, parameter),
          conditions,
          inverseFunction: 'acos',
          period,
          branch: 'maximum'
        }];
      }
      if (numeric !== null && Math.abs(numeric + 1) <= tolerance) {
        return [{
          value: this.#withPeriod(this.#symbol('pi'), period, parameter),
          conditions,
          inverseFunction: 'acos',
          period,
          branch: 'minimum'
        }];
      }
      const principal = this.#function('acos', value);
      return [
        {
          value: this.#withPeriod(principal, period, parameter),
          conditions,
          inverseFunction: 'acos',
          period,
          branch: 'principal'
        },
        {
          value: this.#withPeriod(this.#negate(principal), period, parameter),
          conditions,
          inverseFunction: 'acos',
          period,
          branch: 'reflection'
        }
      ];
    }

    const principal = this.#function('atan', value);
    return [{
      value: this.#withPeriod(principal, period, parameter),
      conditions,
      inverseFunction: 'atan',
      period,
      branch: 'principal'
    }];
  }

  #periodicBranches(
    name: string,
    value: MathNode,
    parameter: string
  ): readonly PeriodicBranch[] {
    if (name === 'sin' || name === 'cos' || name === 'tan') {
      return this.#primaryBranches(name, value, parameter);
    }
    const numeric = this.#numericValue(value);
    if (name === 'sec' || name === 'csc') {
      if (numeric === 0) {
        return [];
      }
      const conditions = [
        this.#condition('nonzero', value),
        this.#condition('nonnegative', this.#subtract(this.#pow(value, 2), this.#constant(1)))
      ];
      return this.#primaryBranches(
        name === 'sec' ? 'cos' : 'sin',
        this.#divide(this.#constant(1), value),
        parameter,
        conditions
      );
    }
    if (name === 'cot') {
      const halfPi = this.#divide(this.#symbol('pi'), this.#constant(2));
      const period = this.#period(1);
      if (numeric !== null && Math.abs(numeric) <= 1e-12) {
        return [{
          value: this.#withPeriod(halfPi, period, parameter),
          conditions: [],
          inverseFunction: 'acot',
          period,
          branch: 'zero'
        }];
      }
      const nonzero = this.#condition('nonzero', value);
      const reciprocal = this.#primaryBranches(
        'tan',
        this.#divide(this.#constant(1), value),
        parameter,
        [nonzero]
      );
      if (numeric !== null) {
        return reciprocal;
      }
      return [
        ...reciprocal,
        {
          value: this.#withPeriod(halfPi, period, parameter),
          conditions: [this.#condition('zero', value)],
          inverseFunction: 'acot',
          period,
          branch: 'zero'
        }
      ];
    }
    return [];
  }

  #inverseConditions(name: string, value: MathNode): readonly Condition[] | null {
    const numeric = this.#numericValue(value);
    const halfPi = this.#divide(this.#symbol('pi'), this.#constant(2));
    if (numeric !== null) {
      const valid = name === 'asin'
        ? numeric >= -Math.PI / 2 && numeric <= Math.PI / 2
        : name === 'acos'
          ? numeric >= 0 && numeric <= Math.PI
          : numeric > -Math.PI / 2 && numeric < Math.PI / 2;
      return valid ? [] : null;
    }
    if (name === 'asin') {
      return [
        this.#condition('nonnegative', this.#add(value, halfPi)),
        this.#condition('nonnegative', this.#subtract(halfPi, value))
      ];
    }
    if (name === 'acos') {
      return [
        this.#condition('nonnegative', value),
        this.#condition('nonnegative', this.#subtract(this.#symbol('pi'), value))
      ];
    }
    return [
      this.#condition('positive', this.#add(value, halfPi)),
      this.#condition('positive', this.#subtract(halfPi, value))
    ];
  }

  #replaceNode(root: MathNode, oldNode: MathNode, replacement: MathNode): MathNode {
    return root.transform<MathNode>((candidate) => candidate === oldNode ? replacement : candidate);
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

  #solveInverse(
    equation: EqualityNode,
    target: string,
    name: string,
    inner: MathNode,
    value: MathNode,
    outerConditions: readonly Condition[],
    options?: SolveOptions
  ): SolveResult {
    const range = this.#inverseConditions(name, value);
    if (range === null) {
      return Object.freeze({kind: 'contradiction', target, conditions: Object.freeze([])});
    }
    const direct = this.#function(
      name === 'asin' ? 'sin' : name === 'acos' ? 'cos' : 'tan',
      value
    );
    const innerResult = this.#dependencies.polynomialSolve(
      new this.#dependencies.EqualityNode(inner, direct),
      target,
      options,
      1
    );
    const candidates = this.#candidateValues(innerResult);
    if (candidates === null) {
      return unsupportedResult(target, 'unsupported-trig-form');
    }
    if (!isSolutionArray(candidates)) {
      return candidates;
    }
    const solutions: Solution[] = [];
    for (const candidate of candidates) {
      const normalized = this.#dependencies.symbolicKernel.normalizeConditions([
        ...outerConditions,
        ...range,
        ...candidate.conditions
      ]);
      if (!normalized.contradictory) {
        solutions.push(Object.freeze({
          value: candidate.value,
          conditions: normalized.conditions,
          exact: true,
          verification: Object.freeze({
            status: 'proven',
            evidence: Object.freeze({method: 'construction'})
          })
        }));
      }
    }
    if (solutions.length === 0) {
      return Object.freeze({kind: 'contradiction', target, conditions: Object.freeze([])});
    }
    const frozen = Object.freeze(solutions);
    if (frozen.some((solution) => solution.conditions.length > 0)) {
      return Object.freeze({
        kind: 'partial',
        target,
        solutions: frozen,
        remainder: equation,
        reason: 'verification-inconclusive'
      });
    }
    return Object.freeze({kind: 'finite', target, solutions: frozen}) as FiniteSolutions;
  }

  solve(
    equation: EqualityNode,
    target: string,
    options?: SolveOptions
  ): SolveResult {
    if (options?.domain === 'complex') {
      return unsupportedResult(target, 'unsupported-domain');
    }
    const supportedNodes: MathNode[] = [];
    for (const root of [equation.lhs, equation.rhs]) {
      root.traverse((candidate) => {
        if (
          isFunctionNode(candidate) &&
          isSymbolNode(candidate.fn) &&
          (candidate.fn.name in CIRCULAR_FUNCTIONS || INVERSE_FUNCTIONS.has(candidate.fn.name)) &&
          candidate.args.length === 1 &&
          targetOccurrences(candidate, target) > 0
        ) {
          supportedNodes.push(candidate);
        }
      });
    }
    if (supportedNodes.length === 0) {
      return unsupportedResult(target, 'no-rule');
    }
    if (supportedNodes.length !== 1) {
      return unsupportedResult(target, 'unsupported-trig-form');
    }
    const trigNode = supportedNodes[0]!;
    if (!isFunctionNode(trigNode) || !isSymbolNode(trigNode.fn)) {
      return unsupportedResult(target, 'unsupported-trig-form');
    }
    const name = trigNode.fn.name;
    const inner = trigNode.args[0]!;
    const used = new Set([
      ...nodeSymbols(equation.lhs),
      ...nodeSymbols(equation.rhs),
      target
    ]);
    let placeholderName = '__symbolicjs_trig_atom';
    while (used.has(placeholderName)) {
      placeholderName += '_';
    }
    const placeholder = this.#symbol(placeholderName);
    const reduced = new this.#dependencies.EqualityNode(
      this.#replaceNode(equation.lhs, trigNode, placeholder),
      this.#replaceNode(equation.rhs, trigNode, placeholder)
    );
    const outerResult = this.#dependencies.polynomialSolve(
      reduced,
      placeholderName,
      options,
      1
    );
    const outerCandidates = this.#candidateValues(outerResult);
    if (outerCandidates === null) {
      return unsupportedResult(target, 'unsupported-trig-form');
    }
    if (!isSolutionArray(outerCandidates)) {
      return limitResult(target, outerCandidates.limit);
    }
    const context = new SolverContext(target, options);
    const families: ParametricFamily[] = [];

    for (const outerCandidate of outerCandidates) {
      if (nodeSymbols(outerCandidate.value).includes(target)) {
        return unsupportedResult(target, 'unsupported-trig-form');
      }
      if (INVERSE_FUNCTIONS.has(name)) {
        return this.#solveInverse(
          equation,
          target,
          name,
          inner,
          outerCandidate.value,
          outerCandidate.conditions,
          options
        );
      }
      const parameter = allocateIntegerParameter(used);
      const branches = this.#periodicBranches(name, outerCandidate.value, parameter.name);
      if (branches.length === 0) {
        return Object.freeze({kind: 'contradiction', target, conditions: Object.freeze([])});
      }
      const branchLimit = context.consume('branches', branches.length);
      if (branchLimit) {
        return branchLimit;
      }
      for (const branch of branches) {
        const workLimit = context.consume('total-work');
        if (workLimit) {
          return workLimit;
        }
        const innerResult = this.#dependencies.polynomialSolve(
          new this.#dependencies.EqualityNode(inner, branch.value),
          target,
          options,
          1
        );
        const innerCandidates = this.#candidateValues(innerResult);
        if (innerCandidates && !isSolutionArray(innerCandidates)) {
          return innerCandidates;
        }
        if (!innerCandidates) {
          return unsupportedResult(target, 'unsupported-trig-form');
        }
        for (const candidate of innerCandidates) {
          const familyLimit = context.consume('parametric-families');
          if (familyLimit) {
            return familyLimit;
          }
          const normalized = this.#dependencies.symbolicKernel.normalizeConditions([
            ...outerCandidate.conditions,
            ...branch.conditions,
            ...candidate.conditions
          ]);
          if (normalized.contradictory) {
            continue;
          }
          families.push(Object.freeze({
            value: candidate.value,
            parameters: Object.freeze([parameter]),
            conditions: normalized.conditions,
            exact: true,
            verification: Object.freeze({
              status: 'proven',
              evidence: Object.freeze({method: 'construction'})
            }),
            certificate: Object.freeze({
              kind: 'periodic',
              functionName: name,
              inverseFunction: branch.inverseFunction,
              period: branch.period,
              inner,
              branch: branch.branch
            })
          }));
        }
      }
    }

    if (families.length === 0) {
      return Object.freeze({kind: 'contradiction', target, conditions: Object.freeze([])});
    }
    return parametricResult(
      target,
      this.#dependencies.canonicalizeParametricFamilies(families, [...used])
    );
  }
}

export const createTrigonometricSolve = customFactory(
  'trigonometricSolve',
  [
    'ConstantNode',
    'EqualityNode',
    'FunctionNode',
    'OperatorNode',
    'SymbolNode',
    'canonicalizeParametricFamilies',
    'polynomialSolve',
    'symbolicKernel'
  ],
  (rawDependencies) => {
    const engine = new TrigonometricEngine(
      rawDependencies as unknown as TrigonometricDependencies
    );
    return (
      equation: EqualityNode,
      target: string,
      options?: SolveOptions
    ) => engine.solve(equation, target, options);
  }
);
