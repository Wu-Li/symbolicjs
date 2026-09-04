import type {MathJsInstance, MathNode} from 'mathjs';
import type {EqualityNodeConstructor} from '../types.js';

export type MathJsonReviver = (
  this: unknown,
  key: string,
  value: unknown
) => unknown;

export interface MathAdapterDependencies {
  readonly ConstantNode: MathJsInstance['ConstantNode'];
  readonly EqualityNode: EqualityNodeConstructor;
  readonly FunctionNode: MathJsInstance['FunctionNode'];
  readonly OperatorNode: MathJsInstance['OperatorNode'];
  readonly SymbolNode: MathJsInstance['SymbolNode'];
  readonly mathWithTransform: Readonly<Record<string, unknown>>;
  readonly parse: MathJsInstance['parse'];
  readonly reviver: MathJsonReviver;
}

function requireFunction(value: unknown, name: string): void {
  if (typeof value !== 'function') {
    throw new TypeError(`MathJS dependency "${name}" must be a function`);
  }
}

/**
 * Narrow, instance-local boundary around the MathJS services used by the new
 * symbolic layer. The adapter intentionally does not copy the MathJS namespace:
 * later imports on that configured instance remain visible through lookup().
 */
export class MathAdapter {
  readonly ConstantNode: MathAdapterDependencies['ConstantNode'];
  readonly EqualityNode: MathAdapterDependencies['EqualityNode'];
  readonly FunctionNode: MathAdapterDependencies['FunctionNode'];
  readonly OperatorNode: MathAdapterDependencies['OperatorNode'];
  readonly SymbolNode: MathAdapterDependencies['SymbolNode'];

  readonly #mathNamespace: MathAdapterDependencies['mathWithTransform'];
  readonly #parse: MathAdapterDependencies['parse'];
  readonly #reviver: MathAdapterDependencies['reviver'];

  constructor(dependencies: MathAdapterDependencies) {
    requireFunction(dependencies.ConstantNode, 'ConstantNode');
    requireFunction(dependencies.EqualityNode, 'EqualityNode');
    requireFunction(dependencies.FunctionNode, 'FunctionNode');
    requireFunction(dependencies.OperatorNode, 'OperatorNode');
    requireFunction(dependencies.SymbolNode, 'SymbolNode');
    requireFunction(dependencies.parse, 'parse');
    requireFunction(dependencies.reviver, 'reviver');
    if (
      !dependencies.mathWithTransform ||
      typeof dependencies.mathWithTransform !== 'object'
    ) {
      throw new TypeError('MathJS dependency "mathWithTransform" must be an object');
    }

    this.ConstantNode = dependencies.ConstantNode;
    this.EqualityNode = dependencies.EqualityNode;
    this.FunctionNode = dependencies.FunctionNode;
    this.OperatorNode = dependencies.OperatorNode;
    this.SymbolNode = dependencies.SymbolNode;
    this.#mathNamespace = dependencies.mathWithTransform;
    this.#parse = dependencies.parse;
    this.#reviver = dependencies.reviver;
    Object.freeze(this);
  }

  parse(source: string): MathNode {
    if (typeof source !== 'string') {
      throw new TypeError('MathJS expression source must be a string');
    }
    return this.#parse(source);
  }

  has(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.#mathNamespace, name);
  }

  lookup(name: string): unknown {
    return this.has(name) ? this.#mathNamespace[name] : undefined;
  }

  revive<T>(serialized: string): T {
    if (typeof serialized !== 'string') {
      throw new TypeError('Serialized MathJS value must be a string');
    }
    return JSON.parse(serialized, this.#reviver) as T;
  }

  isNode(value: unknown): value is MathNode {
    return Boolean(
      value &&
      typeof value === 'object' &&
      (value as Partial<MathNode>).isNode === true
    );
  }
}
