import {
  isConstantNode,
  isFunctionNode,
  isOperatorNode,
  isParenthesisNode,
  isSymbolNode
} from 'mathjs';
import type {MathNode} from 'mathjs';
import {DefinednessAnalyzer} from './definedness.js';
import {discoverFreeSymbols} from './free-symbols.js';
import {domainImplies} from './domains.js';
import type {SymbolicDomain} from './domains.js';
import {MathAdapter} from './math-adapter.js';
import {OperationContext} from './operation-context.js';
import {
  createJudgment,
  predicateKey,
  PredicateFactory
} from './predicate.js';
import type {
  Judgment,
  RequirementResult,
  SymbolicEvidence,
  SymbolicPredicate,
  SymbolicProperty
} from './predicate.js';
import {SymbolicRegistry} from './registry.js';

interface Evaluation {
  readonly succeeded: boolean;
  readonly value?: unknown;
}

interface NumericScalar {
  readonly re: number;
  readonly im: number;
  readonly integer: boolean;
  readonly rational: boolean;
  readonly finite: boolean;
}

function propertyPredicate(
  factory: PredicateFactory,
  property: SymbolicProperty,
  expression: MathNode
): SymbolicPredicate {
  return factory.property(property, expression);
}

/** Conservative 3-valued semantic queries over MathJS expression trees. */
export class PredicateEngine {
  readonly #math: MathAdapter;
  readonly #predicates: PredicateFactory;
  readonly #registry: SymbolicRegistry;
  readonly #definedness: DefinednessAnalyzer;

  constructor(
    math: MathAdapter,
    predicates: PredicateFactory,
    registry: SymbolicRegistry,
    definedness: DefinednessAnalyzer
  ) {
    this.#math = math;
    this.#predicates = predicates;
    this.#registry = registry;
    this.#definedness = definedness;
    Object.freeze(this);
  }

  ask(predicate: SymbolicPredicate, context: OperationContext): Judgment {
    return context.memoize(
      predicate.expression,
      `predicate:${predicateKey(predicate)}`,
      () => this.#askUncached(predicate, context)
    );
  }

  require(
    predicate: SymbolicPredicate,
    context: OperationContext
  ): RequirementResult {
    const judgment = this.ask(predicate, context);
    if (judgment.truth === 'proven') {
      return Object.freeze({kind: 'satisfied', judgment});
    }
    if (judgment.truth === 'disproven') {
      return Object.freeze({kind: 'rejected', reason: 'disproven', judgment});
    }
    if (context.mode === 'conditional') {
      return Object.freeze({
        kind: 'conditional',
        requirements: judgment.requirements,
        judgment
      });
    }
    return Object.freeze({kind: 'rejected', reason: 'unproven', judgment});
  }

  #askUncached(
    predicate: SymbolicPredicate,
    context: OperationContext
  ): Judgment {
    const assumed = context.assumptions.ask(predicate);
    if (assumed.truth !== 'unknown') {
      return assumed;
    }

    const evaluation = this.#evaluate(predicate.expression, context);
    if (evaluation.succeeded) {
      const evaluated = this.#fromValue(
        predicate,
        evaluation.value,
        predicate.expression
      );
      if (evaluated) {
        return evaluated;
      }
    }

    const structural = this.#fromStructure(predicate, context);
    return structural ?? createJudgment('unknown', [predicate]);
  }

  #evaluate(expression: MathNode, context: OperationContext): Evaluation {
    if (isConstantNode(expression)) {
      return Object.freeze({succeeded: true, value: expression.value});
    }
    if (isSymbolNode(expression)) {
      if (Object.prototype.hasOwnProperty.call(context.scope, expression.name)) {
        return Object.freeze({
          succeeded: true,
          value: context.scope[expression.name]
        });
      }
      if (this.#math.has(expression.name)) {
        return Object.freeze({
          succeeded: true,
          value: this.#math.lookup(expression.name)
        });
      }
    }
    const unresolved = discoverFreeSymbols(
      expression,
      (name) => this.#math.has(name)
    ).some((name) => !Object.prototype.hasOwnProperty.call(context.scope, name));
    if (unresolved) {
      return Object.freeze({succeeded: false});
    }
    try {
      return Object.freeze({
        succeeded: true,
        value: expression.compile().evaluate(context.scope)
      });
    } catch {
      return Object.freeze({succeeded: false});
    }
  }

  #guard(name: string, value: unknown): boolean {
    const guard = this.#math.lookup(name);
    if (typeof guard === 'function') {
      try {
        if (Boolean((guard as (candidate: unknown) => unknown)(value))) {
          return true;
        }
      } catch {
        // Fall through to MathJS's instance marker contract.
      }
    }
    if (!value || typeof value !== 'object') {
      return false;
    }
    const prototype = Object.getPrototypeOf(value) as Record<string, unknown> | null;
    return prototype?.[name] === true;
  }

  #numeric(
    value: unknown,
    expression: MathNode
  ): NumericScalar | null {
    if (typeof value === 'number') {
      return {
        re: value,
        im: 0,
        integer: Number.isSafeInteger(value),
        rational: Number.isSafeInteger(value) || isConstantNode(expression),
        finite: Number.isFinite(value)
      };
    }
    if (typeof value === 'bigint') {
      const converted = Number(value);
      return {
        re: converted,
        im: 0,
        integer: true,
        rational: true,
        finite: Number.isFinite(converted)
      };
    }
    if (this.#guard('isComplex', value)) {
      const complex = value as {readonly re: number; readonly im: number};
      return {
        re: complex.re,
        im: complex.im,
        integer: complex.im === 0 && Number.isSafeInteger(complex.re),
        rational: complex.im === 0 && Number.isSafeInteger(complex.re),
        finite: Number.isFinite(complex.re) && Number.isFinite(complex.im)
      };
    }
    if (this.#guard('isFraction', value)) {
      const candidate = value as {
        readonly d?: number;
        readonly n?: number;
        toNumber?: () => number;
        valueOf?: () => number;
      };
      const converted = typeof candidate.toNumber === 'function'
        ? candidate.toNumber()
        : Number(candidate.valueOf?.());
      const denominator = candidate.d ?? 1;
      return {
        re: converted,
        im: 0,
        integer: denominator === 1,
        rational: true,
        finite: Number.isFinite(converted)
      };
    }
    if (this.#guard('isBigNumber', value)) {
      const candidate = value as {
        isInteger?: () => boolean;
        toNumber?: () => number;
      };
      const converted = candidate.toNumber?.() ?? Number.NaN;
      const integer = candidate.isInteger?.() ?? Number.isSafeInteger(converted);
      return {
        re: converted,
        im: 0,
        integer,
        rational: integer || isConstantNode(expression),
        finite: Number.isFinite(converted)
      };
    }
    return null;
  }

  #fromValue(
    predicate: SymbolicPredicate,
    value: unknown,
    expression: MathNode
  ): Judgment | null {
    const numeric = this.#numeric(value, expression);
    const evidence: readonly SymbolicEvidence[] = [{
      source: 'evaluation',
      detail: expression.toString()
    }];

    if (predicate.kind === 'domain') {
      if (!numeric || !numeric.finite) {
        return createJudgment('disproven', [], evidence);
      }
      let truth: Judgment['truth'];
      switch (predicate.domain) {
        case 'complex':
          truth = 'proven';
          break;
        case 'real':
          truth = numeric.im === 0 ? 'proven' : 'disproven';
          break;
        case 'integer':
          truth = numeric.im === 0 && numeric.integer ? 'proven' : 'disproven';
          break;
        case 'rational':
          if (numeric.im !== 0) {
            truth = 'disproven';
          } else if (numeric.rational) {
            truth = 'proven';
          } else {
            return null;
          }
          break;
      }
      return createJudgment(truth, [], evidence);
    }

    let truth: Judgment['truth'] | null = null;
    switch (predicate.property) {
      case 'defined':
        truth = value !== undefined && value !== null &&
          (!numeric || numeric.finite)
          ? 'proven'
          : 'disproven';
        break;
      case 'finite':
        truth = numeric?.finite === true ? 'proven' : 'disproven';
        break;
      case 'scalar':
      case 'commutative':
        truth = numeric ? 'proven' : 'disproven';
        break;
      case 'zero':
        truth = numeric && numeric.finite
          ? numeric.re === 0 && numeric.im === 0 ? 'proven' : 'disproven'
          : null;
        break;
      case 'nonzero':
        truth = numeric && numeric.finite
          ? numeric.re !== 0 || numeric.im !== 0 ? 'proven' : 'disproven'
          : null;
        break;
      case 'positive':
        truth = numeric && numeric.finite
          ? numeric.im === 0 && numeric.re > 0 ? 'proven' : 'disproven'
          : null;
        break;
      case 'nonnegative':
        truth = numeric && numeric.finite
          ? numeric.im === 0 && numeric.re >= 0 ? 'proven' : 'disproven'
          : null;
        break;
      case 'negative':
        truth = numeric && numeric.finite
          ? numeric.im === 0 && numeric.re < 0 ? 'proven' : 'disproven'
          : null;
        break;
      case 'nonpositive':
        truth = numeric && numeric.finite
          ? numeric.im === 0 && numeric.re <= 0 ? 'proven' : 'disproven'
          : null;
        break;
      case 'even':
        truth = numeric && numeric.finite
          ? numeric.integer && numeric.re % 2 === 0 ? 'proven' : 'disproven'
          : null;
        break;
      case 'odd':
        truth = numeric && numeric.finite
          ? numeric.integer && Math.abs(numeric.re % 2) === 1 ? 'proven' : 'disproven'
          : null;
        break;
    }
    return truth ? createJudgment(truth, [], evidence) : null;
  }

  #withExpression(
    predicate: SymbolicPredicate,
    expression: MathNode
  ): SymbolicPredicate {
    return predicate.kind === 'domain'
      ? this.#predicates.domain(expression, predicate.domain)
      : this.#predicates.property(predicate.property, expression);
  }

  #requirements(
    predicates: readonly SymbolicPredicate[],
    context: OperationContext,
    detail: string
  ): Judgment {
    const unique = new Map<string, SymbolicPredicate>();
    const evidence: SymbolicEvidence[] = [];
    let disproven = false;
    for (const predicate of predicates) {
      const judgment = this.ask(predicate, context);
      evidence.push(...judgment.evidence);
      if (judgment.truth === 'disproven') {
        disproven = true;
      } else if (judgment.truth === 'unknown') {
        for (const requirement of judgment.requirements) {
          unique.set(predicateKey(requirement), requirement);
        }
      }
    }
    evidence.push({source: 'structure', detail});
    if (disproven) {
      return createJudgment('disproven', [], evidence);
    }
    if (unique.size === 0) {
      return createJudgment('proven', [], evidence);
    }
    return createJudgment('unknown', [...unique.values()], evidence);
  }

  #definedFromStructure(
    predicate: SymbolicPredicate,
    context: OperationContext
  ): Judgment | null {
    if (predicate.kind !== 'property' || predicate.property !== 'defined') {
      return null;
    }
    const requirements = this.#definedness.requirements(predicate.expression, {
      domain: context.domain,
      includeLeafDefinedness: true
    });
    const predicateIdentity = predicateKey(predicate);
    const requiresSelf = requirements.some((requirement) =>
      predicateKey(requirement) === predicateIdentity
    );
    const dependencies = requirements.filter((requirement) =>
      predicateKey(requirement) !== predicateIdentity
    );
    const dependencyJudgment = dependencies.length === 0
      ? null
      : this.#requirements(dependencies, context, 'definedness-requirements');
    if (dependencyJudgment?.truth === 'disproven') {
      return dependencyJudgment;
    }
    if (requiresSelf) {
      return createJudgment(
        'unknown',
        [predicate],
        dependencyJudgment?.evidence ?? []
      );
    }
    return dependencyJudgment;
  }

  #fromStructure(
    predicate: SymbolicPredicate,
    context: OperationContext
  ): Judgment | null {
    const expression = predicate.expression;
    if (isParenthesisNode(expression)) {
      return this.ask(this.#withExpression(predicate, expression.content), context);
    }

    const defined = this.#definedFromStructure(predicate, context);
    if (defined) {
      return defined;
    }

    if (isOperatorNode(expression)) {
      return this.#operatorJudgment(predicate, expression, context);
    }
    if (isFunctionNode(expression) && isSymbolNode(expression.fn)) {
      return this.#functionJudgment(predicate, expression, context);
    }
    return null;
  }

  #operatorJudgment(
    predicate: SymbolicPredicate,
    expression: import('mathjs').OperatorNode<
      import('mathjs').OperatorNodeOp,
      import('mathjs').OperatorNodeFn,
      MathNode[]
    >,
    context: OperationContext
  ): Judgment | null {
    const semantics = this.#registry.getOperator(expression.fn)?.semantic ?? 'opaque';
    const args = expression.args;

    if (predicate.kind === 'domain') {
      if (semantics === 'division' && predicate.domain === 'integer') {
        return null;
      }
      if (
        semantics === 'addition' ||
        semantics === 'subtraction' ||
        semantics === 'negation' ||
        semantics === 'multiplication' ||
        semantics === 'division'
      ) {
        const requirements: SymbolicPredicate[] = args.map((argument) =>
          this.#predicates.domain(argument, predicate.domain)
        );
        if (semantics === 'division' && args[1]) {
          requirements.push(this.#predicates.nonzero(args[1]));
        }
        return this.#requirements(
          requirements,
          context,
          `${semantics}-domain-${predicate.domain}`
        );
      }
      return null;
    }

    if (predicate.property === 'scalar' || predicate.property === 'commutative') {
      return this.#requirements(
        args.map((argument) => this.#predicates.scalar(argument)),
        context,
        `${semantics}-${predicate.property}`
      );
    }

    if (semantics === 'negation' && args[0]) {
      const mapped: Partial<Record<SymbolicProperty, SymbolicProperty>> = {
        zero: 'zero',
        nonzero: 'nonzero',
        positive: 'negative',
        nonnegative: 'nonpositive',
        negative: 'positive',
        nonpositive: 'nonnegative',
        finite: 'finite',
        even: 'even',
        odd: 'odd'
      };
      const property = mapped[predicate.property];
      return property
        ? this.ask(propertyPredicate(this.#predicates, property, args[0]), context)
        : null;
    }

    if (semantics === 'multiplication') {
      if (predicate.property === 'zero') {
        const judgments = args.map((argument) =>
          this.ask(this.#predicates.zero(argument), context)
        );
        if (judgments.some((judgment) => judgment.truth === 'proven')) {
          return createJudgment('proven', [], [{
            source: 'structure', detail: 'zero-factor'
          }]);
        }
      }
      if (predicate.property === 'nonzero') {
        return this.#requirements(
          args.map((argument) => this.#predicates.nonzero(argument)),
          context,
          'nonzero-product'
        );
      }
    }

    if (
      predicate.property === 'finite' &&
      (semantics === 'addition' ||
        semantics === 'subtraction' ||
        semantics === 'negation' ||
        semantics === 'multiplication' ||
        semantics === 'division')
    ) {
      const requirements = args.map((argument) => this.#predicates.finite(argument));
      if (semantics === 'division' && args[1]) {
        requirements.push(this.#predicates.nonzero(args[1]));
      }
      return this.#requirements(requirements, context, `${semantics}-finite`);
    }

    return null;
  }

  #functionJudgment(
    predicate: SymbolicPredicate,
    expression: import('mathjs').FunctionNode,
    context: OperationContext
  ): Judgment | null {
    if (!isSymbolNode(expression.fn)) {
      return null;
    }
    const semantics = this.#registry.getFunction(expression.fn.name)?.semantic ?? 'opaque';
    if (semantics === 'opaque') {
      return null;
    }
    const argument = expression.args[0];
    if (!argument) {
      return null;
    }

    if (predicate.kind === 'domain') {
      if (predicate.domain === 'integer' || predicate.domain === 'rational') {
        return null;
      }
      const argumentDomain: SymbolicDomain = predicate.domain === 'complex'
        ? 'complex'
        : 'real';
      const requirements = [
        this.#predicates.domain(argument, argumentDomain),
        this.#predicates.defined(expression)
      ];
      const result = this.#requirements(
        requirements,
        context,
        `${semantics}-${predicate.domain}`
      );
      return result.truth === 'proven' &&
        domainImplies(argumentDomain, predicate.domain)
        ? result
        : result;
    }

    if (predicate.property === 'scalar' || predicate.property === 'commutative') {
      return this.#requirements(
        expression.args.map((entry) => this.#predicates.scalar(entry)),
        context,
        `${semantics}-${predicate.property}`
      );
    }

    if (predicate.property === 'positive' && semantics === 'exponential') {
      return this.#requirements(
        [this.#predicates.real(argument)],
        context,
        'real-exponential-positive'
      );
    }
    if (
      predicate.property === 'nonnegative' &&
      (semantics === 'absolute' || semantics === 'square-root')
    ) {
      const requirements = semantics === 'absolute'
        ? [this.#predicates.real(argument)]
        : [this.#predicates.nonnegative(argument)];
      return this.#requirements(
        requirements,
        context,
        `${semantics}-nonnegative`
      );
    }
    return null;
  }
}
