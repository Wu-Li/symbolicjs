import type {MathNode} from 'mathjs';
import type {EqualityNode} from '../types.js';
import {MathAdapter} from './math-adapter.js';

function nonemptyName(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a nonempty string`);
  }
  return value;
}

/** Constructs MathJS nodes exclusively through one configured MathJS instance. */
export class NodeBuilder {
  readonly #math: MathAdapter;

  constructor(math: MathAdapter) {
    this.#math = math;
    Object.freeze(this);
  }

  constant(value: unknown): MathNode {
    return new this.#math.ConstantNode(value as never);
  }

  symbol(name: string): MathNode {
    return new this.#math.SymbolNode(nonemptyName(name, 'Symbol name'));
  }

  operator(
    operator: string,
    functionName: string,
    args: readonly MathNode[],
    implicit = false
  ): MathNode {
    nonemptyName(operator, 'Operator');
    nonemptyName(functionName, 'Operator function name');
    this.#assertNodes(args);
    return new this.#math.OperatorNode(
      operator as never,
      functionName as never,
      [...args] as never,
      implicit
    );
  }

  call(name: string, args: readonly MathNode[]): MathNode {
    nonemptyName(name, 'Function name');
    this.#assertNodes(args);
    return new this.#math.FunctionNode(
      new this.#math.SymbolNode(name),
      [...args]
    );
  }

  equality(lhs: MathNode, rhs: MathNode): EqualityNode {
    this.#assertNodes([lhs, rhs]);
    return new this.#math.EqualityNode(lhs, rhs);
  }

  parse(source: string): MathNode {
    return this.#math.parse(source);
  }

  #assertNodes(nodes: readonly MathNode[]): void {
    if (!Array.isArray(nodes) || nodes.some((node) => !this.#math.isNode(node))) {
      throw new TypeError('MathJS nodes expected');
    }
  }
}
