import type {MathJsInstance, MathNode, NodeCtor} from 'mathjs';
import type {SolveOptions, SolveResult} from './solve-types.js';

export interface EqualityNode extends MathNode {
  readonly type: 'EqualityNode';
  readonly isEqualityNode: true;
  readonly lhs: MathNode;
  readonly rhs: MathNode;
  toJSON(): EqualityNodeJSON;
}

export interface EqualityNodeConstructor {
  new(lhs: MathNode, rhs: MathNode): EqualityNode;
  readonly name: 'EqualityNode';
  fromJSON(json: EqualityNodeJSON): EqualityNode;
}

export interface EqualityNodeJSON {
  mathjs: 'EqualityNode';
  lhs: MathNode;
  rhs: MathNode;
}

export interface symbolicjsInstance extends MathJsInstance {
  EqualityNode: EqualityNodeConstructor;
  parseEquation(expression: string): EqualityNode;
  equationSymbols(equation: EqualityNode): readonly string[];
  solveEquation(
    equation: EqualityNode | string,
    target: string,
    options?: SolveOptions
  ): SolveResult;
}

export interface EqualityNodeDependencies {
  Node: NodeCtor;
  equal: MathJsInstance['equal'];
}

export interface ParseEquationDependencies {
  EqualityNode: EqualityNodeConstructor;
  parse: MathJsInstance['parse'];
}
