import {
  isFunctionNode,
  isOperatorNode,
  isParenthesisNode,
  isSymbolNode
} from 'mathjs';
import type {MathNode} from 'mathjs';
import type {OperationDomain} from './domains.js';
import {MathAdapter} from './math-adapter.js';
import {NodeBuilder} from './node-builder.js';
import {
  predicateKey,
  PredicateFactory
} from './predicate.js';
import type {SymbolicPredicate} from './predicate.js';
import {SymbolicRegistry} from './registry.js';

export interface DefinednessAnalysisOptions {
  readonly domain?: OperationDomain;
  readonly includeLeafDefinedness?: boolean;
  readonly legacySolverCompatibility?: boolean;
}

function numericValue(node: MathNode): number | null {
  try {
    const value = node.compile().evaluate();
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (value && typeof value === 'object') {
      if ('toNumber' in value && typeof value.toNumber === 'function') {
        const converted = value.toNumber();
        return Number.isFinite(converted) ? converted : null;
      }
      if ('valueOf' in value && typeof value.valueOf === 'function') {
        const converted = Number(value.valueOf());
        return Number.isFinite(converted) ? converted : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Collects symbolic obligations required for an expression to be defined. */
export class DefinednessAnalyzer {
  readonly #math: MathAdapter;
  readonly #nodes: NodeBuilder;
  readonly #predicates: PredicateFactory;
  readonly #registry: SymbolicRegistry;

  constructor(
    math: MathAdapter,
    nodes: NodeBuilder,
    predicates: PredicateFactory,
    registry: SymbolicRegistry
  ) {
    this.#math = math;
    this.#nodes = nodes;
    this.#predicates = predicates;
    this.#registry = registry;
    Object.freeze(this);
  }

  requirements(
    node: MathNode,
    options: DefinednessAnalysisOptions = {}
  ): readonly SymbolicPredicate[] {
    if (!this.#math.isNode(node)) {
      throw new TypeError('MathJS node expected for definedness analysis');
    }
    const requirements: SymbolicPredicate[] = [];
    this.#collect(
      node,
      options.domain ?? 'unknown',
      options.includeLeafDefinedness ?? true,
      options.legacySolverCompatibility ?? false,
      requirements
    );
    const unique = new Map<string, SymbolicPredicate>();
    for (const predicate of requirements) {
      unique.set(predicateKey(predicate), predicate);
    }
    return Object.freeze([...unique.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, predicate]) => predicate));
  }

  #collect(
    node: MathNode,
    domain: OperationDomain,
    includeLeafDefinedness: boolean,
    legacySolverCompatibility: boolean,
    requirements: SymbolicPredicate[]
  ): void {
    if (isParenthesisNode(node)) {
      this.#collect(
        node.content,
        domain,
        includeLeafDefinedness,
        legacySolverCompatibility,
        requirements
      );
      return;
    }

    if (isOperatorNode(node)) {
      for (const argument of node.args) {
        this.#collect(
          argument,
          domain,
          includeLeafDefinedness,
          legacySolverCompatibility,
          requirements
        );
      }
      const semantics = this.#registry.getOperator(node.fn)?.semantic ?? 'opaque';
      if (semantics === 'division' && node.args[1]) {
        requirements.push(this.#predicates.nonzero(node.args[1]));
      } else if (semantics === 'power' && node.args[0] && node.args[1]) {
        const exponent = numericValue(node.args[1]);
        if (exponent !== null && exponent < 0) {
          requirements.push(this.#predicates.nonzero(node.args[0]));
        }
        if (
          domain === 'real' &&
          exponent !== null &&
          !Number.isInteger(exponent)
        ) {
          requirements.push(this.#predicates.nonnegative(node.args[0]));
        }
      } else if (semantics === 'opaque' && !legacySolverCompatibility) {
        requirements.push(this.#predicates.defined(node));
      }
      return;
    }

    if (isFunctionNode(node) && isSymbolNode(node.fn)) {
      for (const argument of node.args) {
        this.#collect(
          argument,
          domain,
          includeLeafDefinedness,
          legacySolverCompatibility,
          requirements
        );
      }
      const semantics = this.#registry.getFunction(node.fn.name)?.semantic ?? 'opaque';
      const argument = node.args[0];
      if (semantics === 'opaque') {
        if (!legacySolverCompatibility) {
          requirements.push(this.#predicates.defined(node));
        }
        return;
      }
      if (!argument) {
        requirements.push(this.#predicates.defined(node));
        return;
      }
      if (semantics === 'square-root') {
        if (domain === 'real') {
          requirements.push(this.#predicates.nonnegative(argument));
        }
        return;
      }
      if (semantics === 'nth-root') {
        const degree = node.args[1];
        if (degree) {
          if (!legacySolverCompatibility) {
            requirements.push(this.#predicates.nonzero(degree));
          }
          const numericDegree = numericValue(degree);
          if (
            domain === 'real' &&
            numericDegree !== null &&
            Number.isInteger(numericDegree) &&
            Math.abs(numericDegree) % 2 === 0
          ) {
            requirements.push(this.#predicates.nonnegative(argument));
          }
        }
        return;
      }
      if (semantics === 'logarithm') {
        if (domain === 'complex') {
          requirements.push(this.#predicates.nonzero(argument));
        } else if (domain === 'real') {
          requirements.push(this.#predicates.positive(argument));
        }
        const base = node.args[1];
        if (base) {
          if (domain === 'complex') {
            requirements.push(this.#predicates.nonzero(base));
          } else if (domain === 'real') {
            requirements.push(this.#predicates.positive(base));
          }
          requirements.push(this.#predicates.nonzero(this.#nodes.operator(
            '-',
            'subtract',
            [base, this.#nodes.constant(1)]
          )));
        }
        return;
      }
      if (
        semantics === 'inverse-circular' &&
        domain === 'real' &&
        (node.fn.name === 'asin' || node.fn.name === 'acos')
      ) {
        requirements.push(this.#predicates.nonnegative(this.#nodes.operator(
          '-',
          'subtract',
          [
            this.#nodes.constant(1),
            this.#nodes.operator('^', 'pow', [argument, this.#nodes.constant(2)])
          ]
        )));
      }
      return;
    }

    let children = 0;
    node.forEach((child) => {
      children += 1;
      this.#collect(
        child,
        domain,
        includeLeafDefinedness,
        legacySolverCompatibility,
        requirements
      );
    });
    if (includeLeafDefinedness && children === 0) {
      requirements.push(this.#predicates.defined(node));
    }
  }
}
