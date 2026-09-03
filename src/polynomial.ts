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
  CubicConstructionBranch,
  CubicConstructionCertificate,
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
  FunctionNode: MathJsInstance['FunctionNode'];
  OperatorNode: MathJsInstance['OperatorNode'];
  simplify: MathJsInstance['simplify'];
  SymbolNode: MathJsInstance['SymbolNode'];
  symbolicKernel: SymbolicKernel;
}

export function approximateConditionViolated(
  kind: Condition['kind'],
  value: number,
  tolerance: number
): boolean {
  switch (kind) {
    case 'zero': return Math.abs(value) > tolerance;
    case 'nonzero': return Math.abs(value) <= tolerance;
    case 'positive': return value <= tolerance;
    case 'nonnegative': return value < -tolerance;
    case 'negative': return value >= -tolerance;
    case 'nonpositive': return value > tolerance;
    case 'defined': return false;
  }
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

  #function(name: string, args: MathNode[]): MathNode {
    return new this.#dependencies.FunctionNode(
      new this.#dependencies.SymbolNode(name),
      args
    );
  }

  #algebraicSimplify(node: MathNode): MathNode {
    return this.#dependencies.simplify(node) as MathNode;
  }

  #addNodes(left: MathNode, right: MathNode): MathNode {
    return this.#operator('+', 'add', [left, right]);
  }

  #subtractNodes(left: MathNode, right: MathNode): MathNode {
    return this.#operator('-', 'subtract', [left, right]);
  }

  #multiplyNodes(left: MathNode, right: MathNode): MathNode {
    return this.#operator('*', 'multiply', [left, right]);
  }

  #divideNodes(left: MathNode, right: MathNode): MathNode {
    return this.#operator('/', 'divide', [left, right]);
  }

  #negateNode(value: MathNode): MathNode {
    return this.#operator('-', 'unaryMinus', [value]);
  }

  #powerNode(value: MathNode, exponent: number): MathNode {
    return this.#operator('^', 'pow', [value, this.#constant(exponent)]);
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
    tolerance: number,
    exact = true
  ): Solution | null {
    const rawConditions = [
      ...conditions.map((condition) => this.#dependencies.symbolicKernel.condition(
        condition.kind,
        this.#dependencies.symbolicKernel.substitute(
          condition.expression,
          target,
          candidate
        )
      )),
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
    ];
    if (!exact && rawConditions.some((condition) => {
      const value = this.#numericValue(condition.expression);
      if (value === null) {
        return false;
      }
      return approximateConditionViolated(condition.kind, value, tolerance);
    })) {
      return null;
    }
    const normalized = this.#dependencies.symbolicKernel.normalizeConditions(rawConditions);
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
    let value = this.#dependencies.symbolicKernel.simplify(candidate);
    if (this.#numericValue(value) === 0) {
      value = this.#constant(0);
    }
    return verification.status === 'rejected' ? null : Object.freeze({
      value,
      conditions: normalized.conditions,
      exact,
      verification
    });
  }

  #chargeSymbolicNodes(...nodes: readonly MathNode[]): boolean {
    let count = 0;
    for (const node of nodes) {
      node.traverse(() => { count += 1; });
    }
    this.#limit ??= this.#context.consume('symbolic-expression-nodes', count);
    this.#limit ??= this.#context.consume('total-work', count);
    return this.#limit === null;
  }

  #cubicCertificate(
    branch: CubicConstructionBranch,
    coefficients: readonly [MathNode, MathNode, MathNode, MathNode],
    p: MathNode,
    q: MathNode,
    discriminant: MathNode
  ): CubicConstructionCertificate {
    return Object.freeze({
      kind: 'cubic',
      branch,
      coefficients: Object.freeze([...coefficients]) as readonly [
        MathNode,
        MathNode,
        MathNode,
        MathNode
      ],
      depressedLinearCoefficient: p,
      depressedConstant: q,
      discriminant
    });
  }

  #cubicConstructionSolution(
    candidate: MathNode,
    conditions: readonly Condition[],
    certificate: CubicConstructionCertificate,
    multiplicity = 1
  ): Solution | null {
    const value = this.#algebraicSimplify(candidate);
    if (!this.#chargeSymbolicNodes(value)) {
      return null;
    }
    const normalized = this.#dependencies.symbolicKernel.normalizeConditions([
      ...conditions,
      ...this.#dependencies.symbolicKernel.conditionsForDefinedness(value)
    ]);
    if (normalized.contradictory) {
      return null;
    }
    return Object.freeze({
      value,
      conditions: normalized.conditions,
      exact: true,
      verification: Object.freeze({
        status: 'proven',
        evidence: Object.freeze({method: 'construction'})
      }),
      multiplicity,
      certificate
    });
  }

  #symbolicCubicSolutions(
    equation: EqualityNode,
    target: string,
    coefficients: readonly [MathNode, MathNode, MathNode, MathNode],
    domainConditions: readonly Condition[]
  ): SolveResult {
    const [a, b, c, d] = coefficients;
    const three = this.#constant(3);
    const commonConditions = [...domainConditions];
    if (this.#numericValue(a) === null) {
      commonConditions.push(this.#dependencies.symbolicKernel.condition('nonzero', a));
    }

    const aSquared = this.#powerNode(a, 2);
    const aCubed = this.#powerNode(a, 3);
    const bSquared = this.#powerNode(b, 2);
    const bCubed = this.#powerNode(b, 3);
    const p = this.#algebraicSimplify(this.#divideNodes(
      this.#subtractNodes(this.#multiplyNodes(this.#multiplyNodes(three, a), c), bSquared),
      this.#multiplyNodes(three, aSquared)
    ));
    const q = this.#algebraicSimplify(this.#divideNodes(
      this.#addNodes(
        this.#subtractNodes(
          this.#multiplyNodes(this.#constant(2), bCubed),
          this.#multiplyNodes(
            this.#multiplyNodes(this.#constant(9), a),
            this.#multiplyNodes(b, c)
          )
        ),
        this.#multiplyNodes(
          this.#multiplyNodes(this.#constant(27), aSquared),
          d
        )
      ),
      this.#multiplyNodes(this.#constant(27), aCubed)
    ));
    const halfQ = this.#divideNodes(q, this.#constant(2));
    const thirdP = this.#divideNodes(p, three);
    const discriminant = this.#algebraicSimplify(this.#addNodes(
      this.#powerNode(halfQ, 2),
      this.#powerNode(thirdP, 3)
    ));
    const shift = this.#algebraicSimplify(this.#divideNodes(
      b,
      this.#multiplyNodes(three, a)
    ));
    if (!this.#chargeSymbolicNodes(p, q, discriminant, shift)) {
      return this.#limit!;
    }

    const discriminantValue = this.#numericValue(discriminant);
    const qValue = this.#numericValue(q);
    const specifications: {
      candidate: MathNode;
      conditions: readonly Condition[];
      branch: CubicConstructionBranch;
      multiplicity?: number;
    }[] = [];
    const condition = (kind: Condition['kind'], expression: MathNode) =>
      this.#dependencies.symbolicKernel.condition(kind, expression);

    const addOneReal = (): void => {
      const rootDiscriminant = this.#function('sqrt', [discriminant]);
      const negativeHalfQ = this.#negateNode(halfQ);
      const u = this.#function('nthRoot', [
        this.#addNodes(negativeHalfQ, rootDiscriminant),
        this.#constant(3)
      ]);
      const v = this.#function('nthRoot', [
        this.#subtractNodes(negativeHalfQ, rootDiscriminant),
        this.#constant(3)
      ]);
      specifications.push({
        candidate: this.#subtractNodes(this.#addNodes(u, v), shift),
        conditions: [...commonConditions, condition('positive', discriminant)],
        branch: 'one-real'
      });
    };

    const addZeroDiscriminant = (): void => {
      if (qValue === null || qValue === 0) {
        specifications.push({
          candidate: this.#negateNode(shift),
          conditions: [
            ...commonConditions,
            condition('zero', discriminant),
            condition('zero', q)
          ],
          branch: 'triple-root',
          multiplicity: 3
        });
      }
      if (qValue === null || qValue !== 0) {
        const u = this.#function('nthRoot', [
          this.#negateNode(halfQ),
          this.#constant(3)
        ]);
        const zeroConditions = [
          ...commonConditions,
          condition('zero', discriminant),
          condition('nonzero', q)
        ];
        specifications.push({
          candidate: this.#subtractNodes(
            this.#multiplyNodes(this.#constant(2), u),
            shift
          ),
          conditions: zeroConditions,
          branch: 'simple-and-double'
        });
        specifications.push({
          candidate: this.#subtractNodes(this.#negateNode(u), shift),
          conditions: zeroConditions,
          branch: 'simple-and-double',
          multiplicity: 2
        });
      }
    };

    const addThreeReal = (): void => {
      const radius = this.#multiplyNodes(
        this.#constant(2),
        this.#function('sqrt', [this.#negateNode(thirdP)])
      );
      const cosineArgument = this.#algebraicSimplify(this.#multiplyNodes(
        this.#divideNodes(
          this.#multiplyNodes(three, q),
          this.#multiplyNodes(this.#constant(2), p)
        ),
        this.#function('sqrt', [this.#divideNodes(this.#constant(-3), p)])
      ));
      const theta = this.#divideNodes(
        this.#function('acos', [cosineArgument]),
        three
      );
      const rangeCondition = condition('nonnegative', this.#subtractNodes(
        this.#constant(1),
        this.#powerNode(cosineArgument, 2)
      ));
      for (let index = 0; index < 3; index += 1) {
        const angle = index === 0
          ? theta
          : this.#subtractNodes(
            theta,
            this.#divideNodes(
              this.#multiplyNodes(
                this.#constant(2 * index),
                new this.#dependencies.SymbolNode('pi')
              ),
              three
            )
          );
        specifications.push({
          candidate: this.#subtractNodes(
            this.#multiplyNodes(radius, this.#function('cos', [angle])),
            shift
          ),
          conditions: [
            ...commonConditions,
            condition('negative', discriminant),
            condition('negative', p),
            rangeCondition
          ],
          branch: 'three-real'
        });
      }
    };

    if (discriminantValue === null || discriminantValue > 0) {
      addOneReal();
    }
    if (discriminantValue === null || discriminantValue === 0) {
      addZeroDiscriminant();
    }
    if (discriminantValue === null || discriminantValue < 0) {
      addThreeReal();
    }

    if (specifications.length > 1) {
      this.#limit ??= this.#context.consume('branches', specifications.length);
      if (this.#limit) {
        return this.#limit;
      }
    }
    const solutions: Solution[] = [];
    for (const specification of specifications) {
      this.#limit ??= this.#context.consume('candidates');
      if (this.#limit) {
        return this.#limit;
      }
      const solution = this.#cubicConstructionSolution(
        specification.candidate,
        specification.conditions,
        this.#cubicCertificate(
          specification.branch,
          coefficients,
          p,
          q,
          discriminant
        ),
        specification.multiplicity
      );
      if (this.#limit) {
        return this.#limit;
      }
      if (solution) {
        solutions.push(solution);
      }
    }
    if (solutions.length === 0) {
      return contradiction(target, domainConditions);
    }
    return Object.freeze({
      kind: 'partial',
      target,
      solutions: Object.freeze(solutions),
      remainder: equation,
      reason: 'verification-inconclusive'
    });
  }

  #cubicSolutions(
    equation: EqualityNode,
    target: string,
    residual: Polynomial,
    domainConditions: readonly Condition[],
    options?: SolveOptions
  ): SolveResult {
    const coefficientNodes = [3, 2, 1, 0].map((degree) =>
      residual.get(degree) ?? this.#constant(0)
    ) as [MathNode, MathNode, MathNode, MathNode];
    const coefficients = coefficientNodes.map((coefficient) =>
      this.#numericValue(coefficient)
    );
    if (coefficients.some((coefficient) => coefficient === null)) {
      return this.#symbolicCubicSolutions(
        equation,
        target,
        coefficientNodes,
        domainConditions
      );
    }
    const [a, b, c, d] = coefficients as [number, number, number, number];
    const tolerance = options?.tolerance ?? DEFAULT_SOLVE_TOLERANCE;
    if (!Number.isFinite(tolerance) || tolerance <= 0) {
      throw new RangeError('Solve tolerance must be positive and finite');
    }
    const normalizedB = b / a;
    const normalizedC = c / a;
    const normalizedD = d / a;
    const p = normalizedC - normalizedB ** 2 / 3;
    const q = 2 * normalizedB ** 3 / 27 - normalizedB * normalizedC / 3 + normalizedD;
    const discriminant = (q / 2) ** 2 + (p / 3) ** 3;
    const scale = Math.max(1, Math.abs(q / 2) ** 2, Math.abs(p / 3) ** 3);
    const discriminantTolerance = tolerance * scale;
    let roots: number[];

    if (discriminant > discriminantTolerance) {
      const sqrtDiscriminant = Math.sqrt(discriminant);
      roots = [
        Math.cbrt(-q / 2 + sqrtDiscriminant) +
        Math.cbrt(-q / 2 - sqrtDiscriminant) -
        normalizedB / 3
      ];
    } else if (discriminant < -discriminantTolerance) {
      const radius = 2 * Math.sqrt(-p / 3);
      const cosine = Math.max(-1, Math.min(
        1,
        (3 * q / (2 * p)) * Math.sqrt(-3 / p)
      ));
      const theta = Math.acos(cosine) / 3;
      roots = [0, 1, 2].map((index) =>
        radius * Math.cos(theta - 2 * Math.PI * index / 3) - normalizedB / 3
      );
    } else if (Math.abs(q) <= tolerance) {
      roots = [-normalizedB / 3];
    } else {
      const repeated = Math.cbrt(-q / 2);
      roots = [2 * repeated - normalizedB / 3, -repeated - normalizedB / 3];
    }

    const evaluate = (value: number) =>
      ((a * value + b) * value + c) * value + d;
    const derivative = (value: number) => (3 * a * value + 2 * b) * value + c;
    const polished: number[] = [];
    for (const root of roots) {
      let value = root;
      for (let iteration = 0; iteration < 8; iteration += 1) {
        this.#limit ??= this.#context.consume('numeric-iterations');
        if (this.#limit) {
          return this.#limit;
        }
        const residualValue = evaluate(value);
        const residualScale = Math.max(
          1,
          Math.abs(a * value ** 3),
          Math.abs(b * value ** 2),
          Math.abs(c * value),
          Math.abs(d)
        );
        if (Math.abs(residualValue) <= tolerance * residualScale) {
          break;
        }
        const slope = derivative(value);
        if (!Number.isFinite(slope) || Math.abs(slope) <= tolerance) {
          break;
        }
        value -= residualValue / slope;
      }
      if (Number.isFinite(value)) {
        polished.push(Object.is(value, -0) ? 0 : value);
      }
    }
    polished.sort((left, right) => left - right);
    const uniqueRoots = polished.filter((value, index) => {
      if (index === 0) {
        return true;
      }
      const prior = polished[index - 1]!;
      return Math.abs(value - prior) > tolerance * Math.max(1, Math.abs(value), Math.abs(prior));
    });
    if (uniqueRoots.length > 1) {
      this.#limit ??= this.#context.consume('branches', uniqueRoots.length);
      if (this.#limit) {
        return this.#limit;
      }
    }

    const solutions: Solution[] = [];
    for (const root of uniqueRoots) {
      this.#limit ??= this.#context.consume('candidates');
      if (this.#limit) {
        return this.#limit;
      }
      const solution = this.#solution(
        equation,
        target,
        this.#constant(root),
        domainConditions,
        tolerance,
        false
      );
      if (solution) {
        solutions.push(solution);
      }
    }
    if (solutions.length === 0) {
      return contradiction(target, domainConditions);
    }
    return Object.freeze({
      kind: 'finite',
      target,
      solutions: Object.freeze(solutions)
    });
  }

  #quadraticSolutions(
    equation: EqualityNode,
    target: string,
    residual: Polynomial,
    domainConditions: readonly Condition[],
    options?: SolveOptions
  ): SolveResult {
    const a = residual.get(2)!;
    const b = residual.get(1) ?? this.#constant(0);
    const c = residual.get(0) ?? this.#constant(0);
    const aValue = this.#numericValue(a);
    const discriminant = this.#dependencies.symbolicKernel.simplify(
      this.#operator('-', 'subtract', [
        this.#operator('^', 'pow', [b, this.#constant(2)]),
        this.#operator('*', 'multiply', [
          this.#constant(4),
          this.#operator('*', 'multiply', [a, c])
        ])
      ])
    );
    const discriminantValue = this.#numericValue(discriminant);
    if (discriminantValue !== null && discriminantValue < 0) {
      return contradiction(target, domainConditions);
    }

    const commonConditions = [...domainConditions];
    if (aValue === null) {
      commonConditions.push(this.#dependencies.symbolicKernel.condition('nonzero', a));
    }
    if (discriminantValue === null) {
      commonConditions.push(this.#dependencies.symbolicKernel.condition(
        'nonnegative',
        discriminant
      ));
    }
    const denominator = this.#operator('*', 'multiply', [this.#constant(2), a]);
    const negativeB = this.#operator('-', 'unaryMinus', [b]);
    const root = this.#function('sqrt', [discriminant]);
    const candidates = discriminantValue === 0
      ? [this.#operator('/', 'divide', [negativeB, denominator])]
      : [
        this.#operator('/', 'divide', [
          this.#operator('+', 'add', [negativeB, root]),
          denominator
        ]),
        this.#operator('/', 'divide', [
          this.#operator('-', 'subtract', [negativeB, root]),
          denominator
        ])
      ];
    if (candidates.length > 1) {
      this.#limit ??= this.#context.consume('branches', candidates.length);
      if (this.#limit) {
        return this.#limit;
      }
    }

    const unique = new Map<string, Solution>();
    for (const candidate of candidates) {
      this.#limit ??= this.#context.consume('candidates');
      if (this.#limit) {
        return this.#limit;
      }
      const solution = this.#solution(
        equation,
        target,
        candidate,
        commonConditions,
        options?.tolerance ?? DEFAULT_SOLVE_TOLERANCE
      );
      if (solution) {
        unique.set(
          this.#dependencies.symbolicKernel.canonicalKey(solution.value),
          solution
        );
      }
    }
    const solutions = Object.freeze([...unique.values()].sort((left, right) =>
      this.#dependencies.symbolicKernel.canonicalKey(left.value)
        .localeCompare(this.#dependencies.symbolicKernel.canonicalKey(right.value))
    ));
    if (solutions.length === 0) {
      return contradiction(target, domainConditions);
    }
    const conditional =
      aValue === null ||
      discriminantValue === null ||
      solutions.some((solution) => solution.verification.status !== 'proven');
    if (conditional) {
      return Object.freeze({
        kind: 'partial',
        target,
        solutions,
        remainder: equation,
        reason: 'verification-inconclusive'
      });
    }
    return Object.freeze({kind: 'finite', target, solutions});
  }

  solve(
    equation: EqualityNode,
    target: string,
    options?: SolveOptions,
    maximumDegree = 3
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
    if (degree === 2) {
      return this.#quadraticSolutions(
        equation,
        target,
        residual,
        domain.conditions,
        options
      );
    }
    if (degree === 3) {
      return this.#cubicSolutions(
        equation,
        target,
        residual,
        domain.conditions,
        options
      );
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
  [
    'ConstantNode',
    'FunctionNode',
    'OperatorNode',
    'simplify',
    'SymbolNode',
    'symbolicKernel'
  ],
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
