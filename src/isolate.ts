import {
  isFunctionNode,
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
  limitResult,
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
  SolveResult,
  UnsupportedResult
} from './solve-types.js';
import type {EqualityNode} from './types.js';

interface IsolationDependencies {
  ConstantNode: MathJsInstance['ConstantNode'];
  FunctionNode: MathJsInstance['FunctionNode'];
  OperatorNode: MathJsInstance['OperatorNode'];
  SymbolNode: MathJsInstance['SymbolNode'];
  symbolicKernel: SymbolicKernel;
}

interface IsolationState {
  readonly expression: MathNode;
  readonly other: MathNode;
  readonly conditions: readonly Condition[];
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

function frozenConditions(conditions: readonly Condition[]): readonly Condition[] {
  return Object.freeze([...conditions]);
}

function identity(target: string, conditions: readonly Condition[] = []): IdentityResult {
  return Object.freeze({kind: 'identity', target, conditions: frozenConditions(conditions)});
}

function contradiction(
  target: string,
  conditions: readonly Condition[] = []
): ContradictionResult {
  return Object.freeze({kind: 'contradiction', target, conditions: frozenConditions(conditions)});
}

function isLimitResult(value: unknown): value is LimitResult {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as Partial<LimitResult>).kind === 'limit'
  );
}

export class IsolationEngine {
  readonly #dependencies: IsolationDependencies;

  constructor(dependencies: IsolationDependencies) {
    this.#dependencies = dependencies;
  }

  #operator(op: string, fn: string, args: MathNode[]): MathNode {
    return new this.#dependencies.OperatorNode(op as never, fn as never, args);
  }

  #unaryMinus(node: MathNode): MathNode {
    return this.#operator('-', 'unaryMinus', [node]);
  }

  #function(name: string, args: MathNode[]): MathNode {
    return new this.#dependencies.FunctionNode(
      new this.#dependencies.SymbolNode(name),
      args
    );
  }

  #numericValue(node: MathNode): number | null {
    if (nodeSymbols(node).length > 0) {
      return null;
    }
    try {
      const value = node.compile().evaluate();
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  }

  #condition(kind: Condition['kind'], expression: MathNode): Condition {
    return this.#dependencies.symbolicKernel.condition(kind, expression);
  }

  #terminal(
    equation: EqualityNode,
    target: string,
    state: IsolationState,
    context: SolverContext,
    tolerance: number
  ): Solution | LimitResult | null {
    const candidateLimit = context.consume('candidates');
    if (candidateLimit) {
      return candidateLimit;
    }
    let candidate = this.#dependencies.symbolicKernel.simplify(state.other);
    if (this.#numericValue(candidate) === 0) {
      candidate = new this.#dependencies.ConstantNode(0);
    }
    const substitutedLhs = this.#dependencies.symbolicKernel.substitute(
      equation.lhs,
      target,
      candidate
    );
    const substitutedRhs = this.#dependencies.symbolicKernel.substitute(
      equation.rhs,
      target,
      candidate
    );
    const normalized = this.#dependencies.symbolicKernel.normalizeConditions([
      ...state.conditions,
      ...this.#dependencies.symbolicKernel.conditionsForDefinedness(substitutedLhs),
      ...this.#dependencies.symbolicKernel.conditionsForDefinedness(substitutedRhs)
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
    if (verification.status === 'rejected') {
      return null;
    }
    return Object.freeze({
      value: candidate,
      conditions: normalized.conditions,
      exact: true,
      verification
    });
  }

  #expandState(
    state: IsolationState,
    target: string,
    context: SolverContext
  ): readonly IsolationState[] | LimitResult | null {
    const {expression, other, conditions} = state;
    const stepLimit = context.consume('rewrite-steps') ?? context.consume('total-work');
    if (stepLimit) {
      return stepLimit;
    }

    if (isParenthesisNode(expression)) {
      return [{expression: expression.content, other, conditions}];
    }

    if (isOperatorNode(expression)) {
      const args = expression.args;
      if (expression.op === '+' && args.length === 1) {
        return [{expression: args[0]!, other, conditions}];
      }
      if (expression.op === '-' && args.length === 1) {
        return [{
          expression: args[0]!,
          other: this.#unaryMinus(other),
          conditions
        }];
      }
      if (args.length !== 2) {
        return null;
      }
      const left = args[0]!;
      const right = args[1]!;
      const leftHasTarget = targetOccurrences(left, target) > 0;
      const targetPart = leftHasTarget ? left : right;
      const constantPart = leftHasTarget ? right : left;

      if (expression.op === '+') {
        return [{
          expression: targetPart,
          other: this.#operator('-', 'subtract', [other, constantPart]),
          conditions
        }];
      }
      if (expression.op === '-') {
        return leftHasTarget
          ? [{
            expression: left,
            other: this.#operator('+', 'add', [other, right]),
            conditions
          }]
          : [{
            expression: right,
            other: this.#operator('-', 'subtract', [left, other]),
            conditions
          }];
      }
      if (expression.op === '*') {
        return [{
          expression: targetPart,
          other: this.#operator('/', 'divide', [other, constantPart]),
          conditions: [...conditions, this.#condition('nonzero', constantPart)]
        }];
      }
      if (expression.op === '/') {
        return leftHasTarget
          ? [{
            expression: left,
            other: this.#operator('*', 'multiply', [other, right]),
            conditions: [...conditions, this.#condition('nonzero', right)]
          }]
          : [{
            expression: right,
            other: this.#operator('/', 'divide', [left, other]),
            conditions: [...conditions, this.#condition('nonzero', other)]
          }];
      }
      if (expression.op === '^') {
        if (leftHasTarget) {
          const exponent = this.#numericValue(right);
          if (exponent === null || exponent === 0) {
            return null;
          }
          if (exponent === 0.5) {
            return [{
              expression: left,
              other: this.#operator('^', 'pow', [
                other,
                new this.#dependencies.ConstantNode(2)
              ]),
              conditions: [...conditions, this.#condition('nonnegative', other)]
            }];
          }
          if (!Number.isInteger(exponent)) {
            return null;
          }
          const degree = Math.abs(exponent);
          const source = exponent < 0
            ? this.#operator('/', 'divide', [
              new this.#dependencies.ConstantNode(1),
              other
            ])
            : other;
          const root = this.#function('nthRoot', [
            source,
            new this.#dependencies.ConstantNode(degree)
          ]);
          const nextConditions = exponent < 0
            ? [...conditions, this.#condition('nonzero', other)]
            : [...conditions];
          if (degree % 2 === 0) {
            const branchLimit = context.consume('branches', 2);
            if (branchLimit) {
              return branchLimit;
            }
            nextConditions.push(this.#condition('nonnegative', source));
            return [
              {expression: left, other: root, conditions: nextConditions},
              {
                expression: left,
                other: this.#unaryMinus(root),
                conditions: nextConditions
              }
            ];
          }
          return [{expression: left, other: root, conditions: nextConditions}];
        }

        if (targetOccurrences(right, target) > 0) {
          const baseMinusOne = this.#operator('-', 'subtract', [
            left,
            new this.#dependencies.ConstantNode(1)
          ]);
          return [{
            expression: right,
            other: this.#operator('/', 'divide', [
              this.#function('log', [other]),
              this.#function('log', [left])
            ]),
            conditions: [
              ...conditions,
              this.#condition('positive', left),
              this.#condition('nonzero', baseMinusOne),
              this.#condition('positive', other)
            ]
          }];
        }
      }
      return null;
    }

    if (isFunctionNode(expression) && isSymbolNode(expression.fn)) {
      const argument = expression.args[0];
      if (!argument || targetOccurrences(argument, target) === 0) {
        return null;
      }
      if (expression.fn.name === 'sqrt') {
        return [{
          expression: argument,
          other: this.#operator('^', 'pow', [
            other,
            new this.#dependencies.ConstantNode(2)
          ]),
          conditions: [...conditions, this.#condition('nonnegative', other)]
        }];
      }
      if (expression.fn.name === 'exp') {
        return [{
          expression: argument,
          other: this.#function('log', [other]),
          conditions: [...conditions, this.#condition('positive', other)]
        }];
      }
      if (expression.fn.name === 'log' || expression.fn.name === 'log10') {
        const base = expression.args[1] ?? (
          expression.fn.name === 'log10'
            ? new this.#dependencies.ConstantNode(10)
            : new this.#dependencies.SymbolNode('e')
        );
        return [{
          expression: argument,
          other: this.#operator('^', 'pow', [base, other]),
          conditions: [
            ...conditions,
            this.#condition('positive', base),
            this.#condition('nonzero', this.#operator('-', 'subtract', [
              base,
              new this.#dependencies.ConstantNode(1)
            ]))
          ]
        }];
      }
      if (expression.fn.name === 'abs') {
        const branchLimit = context.consume('branches', 2);
        if (branchLimit) {
          return branchLimit;
        }
        const nextConditions = [
          ...conditions,
          this.#condition('nonnegative', other)
        ];
        return [
          {expression: argument, other, conditions: nextConditions},
          {
            expression: argument,
            other: this.#unaryMinus(other),
            conditions: nextConditions
          }
        ];
      }
    }
    return null;
  }

  solve(
    equation: EqualityNode,
    target: string,
    options?: SolveOptions
  ): SolveResult {
    const context = new SolverContext(target, options);
    const preflight = context.preflight(equation);
    if (preflight) {
      return preflight;
    }
    const lhs = this.#dependencies.symbolicKernel.simplify(equation.lhs);
    const rhs = this.#dependencies.symbolicKernel.simplify(equation.rhs);
    const lhsOccurrences = targetOccurrences(lhs, target);
    const rhsOccurrences = targetOccurrences(rhs, target);
    if (lhsOccurrences + rhsOccurrences === 0) {
      const verification = this.#dependencies.symbolicKernel.verify(
        equation,
        target,
        new this.#dependencies.ConstantNode(0)
      );
      return verification.status === 'proven'
        ? identity(target)
        : contradiction(target);
    }
    if (lhsOccurrences + rhsOccurrences !== 1) {
      return unsupportedResult(target, 'no-rule');
    }

    const queue: IsolationState[] = [lhsOccurrences === 1
      ? {expression: lhs, other: rhs, conditions: []}
      : {expression: rhs, other: lhs, conditions: []}];
    const solutions: Solution[] = [];
    let unsupported = false;
    const tolerance = options?.tolerance ?? DEFAULT_SOLVE_TOLERANCE;

    while (queue.length > 0) {
      const depthLimit = context.consume('recursion-depth');
      if (depthLimit) {
        return depthLimit;
      }
      const state = queue.shift()!;
      if (isSymbolNode(state.expression) && state.expression.name === target) {
        const terminal = this.#terminal(
          equation,
          target,
          state,
          context,
          tolerance
        );
        if (isLimitResult(terminal)) {
          return terminal;
        }
        if (terminal) {
          solutions.push(terminal);
        }
        continue;
      }
      const expanded = this.#expandState(state, target, context);
      if (isLimitResult(expanded)) {
        return expanded;
      }
      if (!expanded) {
        unsupported = true;
        continue;
      }
      queue.push(...expanded);
    }

    const unique = new Map<string, Solution>();
    for (const solution of solutions) {
      unique.set(this.#dependencies.symbolicKernel.canonicalKey(solution.value), solution);
    }
    const ordered = Object.freeze([...unique.values()].sort((left, right) =>
      this.#dependencies.symbolicKernel.canonicalKey(left.value)
        .localeCompare(this.#dependencies.symbolicKernel.canonicalKey(right.value))
    ));
    if (ordered.length === 0) {
      return unsupported
        ? unsupportedResult(target, 'unsupported-function')
        : contradiction(target);
    }
    if (unsupported || ordered.some((solution) => solution.verification.status !== 'proven')) {
      const partial: PartialResult = Object.freeze({
        kind: 'partial',
        target,
        solutions: ordered,
        remainder: equation,
        reason: unsupported ? 'unsupported-function' : 'verification-inconclusive'
      });
      return partial;
    }
    const finite: FiniteSolutions = Object.freeze({
      kind: 'finite',
      target,
      solutions: ordered
    });
    return finite;
  }
}

export const createIsolateEquation = customFactory(
  'isolateEquation',
  [
    'ConstantNode',
    'FunctionNode',
    'OperatorNode',
    'SymbolNode',
    'symbolicKernel'
  ],
  (rawDependencies) => {
    const engine = new IsolationEngine(
      rawDependencies as unknown as IsolationDependencies
    );
    return (
      equation: EqualityNode,
      target: string,
      options?: SolveOptions
    ) => engine.solve(equation, target, options);
  }
);
