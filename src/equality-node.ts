import {factory} from 'mathjs';
import type {MathJsInstance, MathNode} from 'mathjs';
import {EQUALITY_NODE_NAME, EQUALITY_OPERATOR} from './constants.js';
import type {
  EqualityNode,
  EqualityNodeConstructor,
  EqualityNodeDependencies,
  EqualityNodeJSON
} from './types.js';

type ArgNames = Record<string, true>;
type EqualityValue = Parameters<MathJsInstance['equal']>[0];
type EvalNode = (
  scope: Map<string, unknown>,
  args: Record<string, unknown>,
  context: unknown
) => unknown;

interface InternalMathNode extends MathNode {
  _compile(math: MathJsInstance, argNames: ArgNames): EvalNode;
}

interface InternalNode extends InternalMathNode {
  _ifNode(node: MathNode): MathNode;
}

type InternalNodeConstructor = new() => InternalNode;

function assertNode(node: MathNode, name: string): void {
  if (!node?.isNode) {
    throw new TypeError('MathJS Node expected for parameter "' + name + '"');
  }
}

export const createEqualityNode = factory(
  EQUALITY_NODE_NAME,
  ['Node', 'equal'],
  ({Node, equal}: EqualityNodeDependencies): EqualityNodeConstructor => {
    // MathJS exposes NodeCtor as constructing MathNode, while custom node
    // implementations also need its protected runtime hooks. Keep that
    // unavoidable type assertion confined to this factory.
    const MathJsNode = Node as unknown as InternalNodeConstructor;

    class EqualityNodeImpl extends MathJsNode implements EqualityNode {
      static readonly name = EQUALITY_NODE_NAME;

      readonly lhs: MathNode;
      readonly rhs: MathNode;

      constructor(lhs: MathNode, rhs: MathNode) {
        super();
        assertNode(lhs, 'lhs');
        assertNode(rhs, 'rhs');
        this.lhs = lhs;
        this.rhs = rhs;
      }

      get type(): 'EqualityNode' {
        return EQUALITY_NODE_NAME;
      }

      get isEqualityNode(): true {
        return true;
      }

      _compile(math: MathJsInstance, argNames: ArgNames): EvalNode {
        const evalLhs = (this.lhs as InternalMathNode)._compile(math, argNames);
        const evalRhs = (this.rhs as InternalMathNode)._compile(math, argNames);

        return (scope, args, context) =>
          equal(
            evalLhs(scope, args, context) as EqualityValue,
            evalRhs(scope, args, context) as EqualityValue
          );
      }

      forEach(
        callback: (node: MathNode, path: string, parent: MathNode) => void
      ): void {
        callback(this.lhs, 'lhs', this);
        callback(this.rhs, 'rhs', this);
      }

      map(
        callback: (node: MathNode, path: string, parent: MathNode) => MathNode
      ): this {
        const lhs = this._ifNode(callback(this.lhs, 'lhs', this));
        const rhs = this._ifNode(callback(this.rhs, 'rhs', this));
        return new EqualityNodeImpl(lhs, rhs) as this;
      }

      clone(): this {
        return new EqualityNodeImpl(this.lhs, this.rhs) as this;
      }

      _toString(options?: object): string {
        return (
          this.lhs.toString(options) +
          ' ' + EQUALITY_OPERATOR + ' ' +
          this.rhs.toString(options)
        );
      }

      _toTex(options?: object): string {
        return this.lhs.toTex(options) + '=' + this.rhs.toTex(options);
      }

      _toHTML(options?: object): string {
        return (
          this.lhs.toHTML(options) +
          '<span class="math-operator math-binary-operator">=:=' +
          '</span>' +
          this.rhs.toHTML(options)
        );
      }

      toJSON(): EqualityNodeJSON {
        return {
          mathjs: EQUALITY_NODE_NAME,
          lhs: this.lhs,
          rhs: this.rhs
        };
      }

      static fromJSON(json: EqualityNodeJSON): EqualityNode {
        return new EqualityNodeImpl(json.lhs, json.rhs);
      }
    }

    return EqualityNodeImpl;
  },
  {isClass: true, isNode: true}
);

export function isEqualityNode(node: unknown): node is EqualityNode {
  return Boolean(
    node &&
    typeof node === 'object' &&
    (node as Partial<EqualityNode>).isEqualityNode === true
  );
}
