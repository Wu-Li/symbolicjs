import type {MathJsInstance, MathNode, NodeCtor} from 'mathjs';
import type {SymbolicContext} from './core/symbolic-context.js';
import type {
  ParametricFamily,
  ParametricSolutions,
  PartialResult,
  RealInterval,
  SolveOptions,
  SolveResult
} from './solve-types.js';
import type {VerificationResult} from './solve-types.js';
import type {SymbolicKernel} from './kernel.js';

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
  readonly symbolic: SymbolicContext;
  readonly symbolicKernel: SymbolicKernel;
  solveEquation(
    equation: EqualityNode | string,
    target: string,
    options?: SolveOptions
  ): SolveResult;
  solveEquationForAll(
    equation: EqualityNode | string,
    options?: SolveOptions
  ): ReadonlyMap<string, SolveResult>;
  numericSolve(
    equation: EqualityNode,
    target: string,
    options?: SolveOptions
  ): SolveResult;
  canonicalizeParametricFamilies(
    families: readonly ParametricFamily[],
    usedSymbols?: readonly string[]
  ): readonly ParametricFamily[];
  instantiateFamily(
    family: ParametricFamily,
    assignments: Readonly<Record<string, number>>
  ): MathNode;
  materializeSolutions(
    result: ParametricSolutions | (PartialResult & {
      readonly families: readonly ParametricFamily[];
    }),
    interval: RealInterval,
    scope?: Readonly<Record<string, unknown>>,
    options?: SolveOptions
  ): SolveResult;
  verifyParametricFamily(
    equation: EqualityNode,
    target: string,
    family: ParametricFamily,
    integers?: readonly number[]
  ): VerificationResult;
}

export interface EqualityNodeDependencies {
  Node: NodeCtor;
  equal: MathJsInstance['equal'];
}

export interface ParseEquationDependencies {
  EqualityNode: EqualityNodeConstructor;
  parse: MathJsInstance['parse'];
}
