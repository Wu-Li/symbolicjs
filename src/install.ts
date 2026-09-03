import type {MathJsInstance} from 'mathjs';
import {createEqualityNode} from './equality-node.js';
import {createParseEquation} from './parse-equation.js';
import {createEquationSymbols} from './analysis.js';
import {createSolveEquation} from './solve.js';
import {createSymbolicKernel} from './kernel.js';
import {createIsolateEquation} from './isolate.js';
import type {symbolicjsInstance} from './types.js';

export const symbolicjsFactories = [
  createEqualityNode,
  createParseEquation,
  createEquationSymbols,
  createSymbolicKernel,
  createIsolateEquation,
  createSolveEquation
] as const;

export function importsymbolicjs(math: MathJsInstance): symbolicjsInstance {
  math.import([...symbolicjsFactories]);
  return math as symbolicjsInstance;
}
