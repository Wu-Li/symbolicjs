import {
  isOperatorNode,
  isParenthesisNode,
  isSymbolNode
} from 'mathjs';
import type {MathJsInstance, MathNode} from 'mathjs';
import {nodeSymbols} from './analysis.js';
import {SolverContext} from './budget.js';
import {customFactory} from './custom-factory.js';
import type {SymbolicKernel} from './kernel.js';
import {
  DEFAULT_SOLVE_TOLERANCE,
  unsupportedResult
} from './solve-types.js';
import type {
  Condition,
  ContradictionResult,
  FiniteSolutions,
  IdentityResult,
  LimitResult,
  PartialResult,
  Solution,
  SolveOptions,
  SolveResult
} from './solve-types.js';
import type {EqualityNode} from './types.js';

type Polynomial = Map<number, MathNode>;

interface RationalPolynomial {
  readonly numerator: Polynomial;
  readonly denominator: Polynomial;
}

interface PolynomialDependencies {
  ConstantNode: MathJsInstance['ConstantNode'];
  OperatorNode: MathJsInstance['OperatorNode'];
  SymbolNode: MathJsInstance['SymbolNode'];
  symbolicKernel: SymbolicKernel;
}

function occurrences(node: MathNode, target: string): number {
  let count = 0;
  node.traverse((candidate) => {
    if (isSymbolNode(candidate) && candidate.name === target) {
      count += 1;
    }
  });
  return count;
}

function identity(target: string, conditions: readonly Condition[]): IdentityResult {
  return Object.freeze({
    kind: 'identity',
    target,
    conditions: Object.freeze([...conditions])
  });
}

function contradiction(
  target: string,
  conditions: readonly Condition[] = []
): ContradictionResult {
  return Object.freeze({
    kind: 'contradiction',
    target,
    conditions: Object.freeze([...conditions])
  });
}

export class PolynomialEngine {
  readonly #dependencies: PolynomialDependencies;
  #context!: SolverContext;
  #limit: LimitResult | null = null;

  constructor(dependencies: PolynomialDependencies) {
    this.#dependencies = dependencies;
  }

  #constant(value: number): MathNode {
    return new this.#dependencies.ConstantNode(value);
  }

  #operator(op: string, fn: string, args: MathNode[]): MathNode {
    return new this.#dependencies.OperatorNode(op as never, fn as never, args);
  }

  #numericValue(node: MathNode): number | null {
    const simplified = this.#dependencies.symbolicKernel.simplify(node);
    if (nodeSymbols(simplified).length > 0) {
      return null;
    }
    try {
      const value = simplified.compile().evaluate();
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  #charge(): boolean {
    this.#limit ??= this.#context.consume('rewrite-steps');
    this.#limit ??= this.#context.consume('total-work');
    return this.#limit === null;
  }

  #normalize(polynomial: Polynomial): Polynomial {
    const result: Polynomial = new Map();
    for (const [degree, coefficient] of polynomial) {
      const simplified = this.#dependencies.symbolicKernel.simplify(coefficient);
      if (this.#numericValue(simplified) !== 0) {
        result.set(degree, simplified);
      }
    }
    return result;
  }

  #constantPolynomial(node: MathNode): Polynomial {
    return new Map([[0, node]]);
  }

  #targetPolynomial(): Polynomial {
    return new Map([[1, this.#constant(1)]]);
  }

  #add(left: Polynomial, right: Polynomial, subtract = false): Polynomial | null {
    if (!this.#charge()) {
      return null;
    }
    const result = new Map(left);
    for (const [degree, coefficient] of right) {
      const existing = result.get(degree) ?? this.#constant(0);
      result.set(degree, this.#operator(
        subtract ? '-' : '+',
        subtract ? 'subtract' : 'add',
        [existing, coefficient]
      ));
    }
    return this.#normalize(result);
  }

  #multiply(left: Polynomial, right: Polynomial): Polynomial | null {
    if (!this.#charge()) {
      return null;
    }
    let result: Polynomial = new Map();
    for (const [leftDegree, leftCoefficient] of left) {
      for (const [rightDegree, rightCoefficient] of right) {
        const degree = leftDegree + rightDegree;
        this.#limit ??= this.#context.checkPolynomialDegree(degree);
        if (this.#limit) {
          return null;
        }
        const term = this.#operator('*', 'multiply', [
          leftCoefficient,
          rightCoefficient
        ]);
        const existing = result.get(degree);
        result.set(
          degree,
          existing
            ? this.#operator('+', 'add', [existing, term])
            : term
        );
      }
    }
    result = this.#normalize(result);
    return result;
  }

  #power(polynomial: Polynomial, exponent: number): Polynomial | null {
    let result = this.#constantPolynomial(this.#constant(1));
    for (let index = 0; index < exponent; index += 1) {
      const product = this.#multiply(result, polynomial);
      if (!product) {
        return null;
      }
      result = product;
    }
    return result;
  }

  #rational(node: MathNode, target: string): RationalPolynomial | null {
    if (occurrences(node, target) === 0) {
      return {
        numerator: this.#constantPolynomial(node),
        denominator: this.#constantPolynomial(this.#constant(1))
      };
    }
    if (isSymbolNode(node) && node.name === target) {
      return {
        numerator: this.#targetPolynomial(),
        denominator: this.#constantPolynomial(this.#constant(1))
      };
    }
    if (isParenthesisNode(node)) {
      return this.#rational(node.content, target);
    }
    if (!isOperatorNode(node)) {
      return null;
    }
    const args = node.args;
    if (args.length === 1 && (node.op === '+' || node.op === '-')) {
      const operand = this.#rational(args[0]!, target);
      if (!operand || node.op === '+') {
        return operand;
      }
      return {
        numerator: this.#multiply(
          this.#constantPolynomial(this.#constant(-1)),
          operand.numerator
        ) ?? new Map(),
        denominator: operand.denominator
      };
    }
    if (args.length !== 2) {
      return null;
    }
    const left = this.#rational(args[0]!, target);
    const right = this.#rational(args[1]!, target);
    if (!left || !right) {
      return null;
    }
    if (node.op === '+' || node.op === '-') {
      const leftNumerator = this.#multiply(left.numerator, right.denominator);
      const rightNumerator = this.#multiply(right.numerator, left.denominator);
      const numerator = leftNumerator && rightNumerator
        ? this.#add(leftNumerator, rightNumerator, node.op === '-')
        : null;
      const denominator = this.#multiply(left.denominator, right.denominator);
      return numerator && denominator ? {numerator, denominator} : null;
    }
    if (node.op === '*') {
      const numerator = this.#multiply(left.numerator, right.numerator);
      const denominator = this.#multiply(left.denominator, right.denominator);
      return numerator && denominator ? {numerator, denominator} : null;
    }
    if (node.op === '/') {
      const numerator = this.#multiply(left.numerator, right.denominator);
      const denominator = this.#multiply(left.denominator, right.numerator);
      return numerator && denominator ? {numerator, denominator} : null;
    }
    if (node.op === '^') {
      const exponent = this.#numericValue(args[1]!);
      if (exponent === null || !Number.isSafeInteger(exponent)) {
        return null;
      }
      const power = Math.abs(exponent);
      const numerator = this.#power(
        exponent < 0 ? left.denominator : left.numerator,
        power
      );
      const denominator = this.#power(
        exponent < 0 ? left.numerator : left.denominator,
        power
      );
      return numerator && denominator ? {numerator, denominator} : null;
    }
    return null;
  }

  #polynomialNode(polynomial: Polynomial, target: string): MathNode {
    const terms = [...polynomial.entries()]
      .sort(([left], [right]) => left - right)
      .map(([degree, coefficient]) => {
        if (degree === 0) {
          return coefficient;
        }
        const variable = new this.#dependencies.SymbolNode(target);
        const power = degree === 1
          ? variable
          : this.#operator('^', 'pow', [variable, this.#constant(degree)]);
        return this.#operator('*', 'multiply', [coefficient, power]);
      });
    return terms.reduce<MathNode>(
      (sum, term) => this.#operator('+', 'add', [sum, term]),
      this.#constant(0)
    );
  }

  #solution(
    equation: EqualityNode,
    target: string,
    candidate: MathNode,
    conditions: readonly Condition[],
    tolerance: number
  ): Solution | null {
    const normalized = this.#dependencies.symbolicKernel.normalizeConditions([
      ...conditions,
      ...this.#dependencies.symbolicKernel.conditionsForDefinedness(
        this.#dependencies.symbolicKernel.substitute(
          equation.lhs,
          target,
          candidate
        )
      ),
      ...this.#dependencies.symbolicKernel.conditionsForDefinedness(
        this.#dependencies.symbolicKernel.substitute(
          equation.rhs,
          target,
          candidate
        )
      )
    ]);
    if (normalized.contradictory) {
      return null;
    }
    const verification = this.#dependencies.symbolicKernel.verify(
      equation,
      target,
      candidate,
      normalized.conditions,
      tolerance
    );
    return verification.status === 'rejected' ? null : Object.freeze({
      value: this.#dependencies.symbolicKernel.simplify(candidate),
      conditions: normalized.conditions,
      exact: true,
      verification
    });
  }

  solve(
    equation: EqualityNode,
    target: string,
    options?: SolveOptions,
    maximumDegree = 1
  ): SolveResult {
    this.#context = new SolverContext(target, options);
    this.#limit = this.#context.preflight(equation);
    if (this.#limit) {
      return this.#limit;
    }
    const left = this.#rational(equation.lhs, target);
    const right = this.#rational(equation.rhs, target);
    if (this.#limit) {
      return this.#limit;
    }
    if (!left || !right) {
      return unsupportedResult(target, 'no-rule');
    }
    const leftNumerator = this.#multiply(left.numerator, right.denominator);
    const rightNumerator = this.#multiply(right.numerator, left.denominator);
    const residual = leftNumerator && rightNumerator
      ? this.#add(leftNumerator, rightNumerator, true)
      : null;
    if (this.#limit) {
      return this.#limit;
    }
    if (!residual) {
      return unsupportedResult(target, 'no-rule');
    }
    const degree = Math.max(-1, ...residual.keys());
    if (degree > maximumDegree) {
      return unsupportedResult(target, 'no-rule');
    }
    const domain = this.#dependencies.symbolicKernel.normalizeConditions([
      ...this.#dependencies.symbolicKernel.conditionsForDefinedness(equation.lhs),
      ...this.#dependencies.symbolicKernel.conditionsForDefinedness(equation.rhs)
    ]);
    if (domain.contradictory) {
      return contradiction(target);
    }
    if (degree <= 0) {
      const constant = residual.get(0) ?? this.#constant(0);
      const value = this.#numericValue(constant);
      if (value === 0) {
        return identity(target, domain.conditions);
      }
      if (value !== null) {
        return contradiction(target, domain.conditions);
      }
      return unsupportedResult(target, 'no-rule');
    }

    const coefficient = residual.get(1)!;
    const constant = residual.get(0) ?? this.#constant(0);
    const coefficientValue = this.#numericValue(coefficient);
    if (coefficientValue === 0) {
      return this.#numericValue(constant) === 0
        ? identity(target, domain.conditions)
        : contradiction(target, domain.conditions);
    }
    const candidate = this.#operator('/', 'divide', [
      this.#operator('-', 'unaryMinus', [constant]),
      coefficient
    ]);
    const conditions = coefficientValue === null
      ? [...domain.conditions, this.#dependencies.symbolicKernel.condition(
        'nonzero',
        coefficient
      )]
      : domain.conditions;
    const solution = this.#solution(
      equation,
      target,
      candidate,
      conditions,
      options?.tolerance ?? DEFAULT_SOLVE_TOLERANCE
    );
    if (!solution) {
      return contradiction(target, domain.conditions);
    }
    const solutions = Object.freeze([solution]);
    if (
      coefficientValue === null ||
      solution.verification.status !== 'proven'
    ) {
      const partial: PartialResult = Object.freeze({
        kind: 'partial',
        target,
        solutions,
        remainder: equation,
        reason: 'verification-inconclusive'
      });
      return partial;
    }
    const finite: FiniteSolutions = Object.freeze({
      kind: 'finite',
      target,
      solutions
    });
    return finite;
  }

  debugPolynomial(node: MathNode, target: string): string | null {
    this.#context = new SolverContext(target);
    this.#limit = null;
    const rational = this.#rational(node, target);
    return rational
      ? this.#polynomialNode(rational.numerator, target).toString()
      : null;
  }
}

export const createPolynomialSolve = customFactory(
  'polynomialSolve',
  ['ConstantNode', 'OperatorNode', 'SymbolNode', 'symbolicKernel'],
  (rawDependencies) => {
    const engine = new PolynomialEngine(
      rawDependencies as unknown as PolynomialDependencies
    );
    return (
      equation: EqualityNode,
      target: string,
      options?: SolveOptions,
      maximumDegree?: number
    ) => engine.solve(equation, target, options, maximumDegree);
  }
);
