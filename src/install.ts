import type {MathJsInstance} from 'mathjs';
import {createEqualityNode} from './equality-node.js';
import {createSymbolicContext} from './core/symbolic-context.js';
import {createParseEquation} from './parse-equation.js';
import {createEquationSymbols} from './analysis.js';
import {createSolveEquation} from './solve.js';
import {createSymbolicKernel} from './kernel.js';
import {createIsolateEquation} from './isolate.js';
import {createPolynomialSolve} from './polynomial.js';
import {createSolveEquationForAll} from './solve-all.js';
import {
  createCanonicalizeParametricFamilies,
  createInstantiateFamily,
  createMaterializeSolutions,
  createVerifyParametricFamily
} from './parametric.js';
import {createTrigonometricSolve} from './trigonometric.js';
import {createCompoundTrigonometricSolve} from './compound-trigonometric.js';
import {createNumericSolve} from './numeric-solve.js';
import type {symbolicjsInstance} from './types.js';

export const symbolicjsFactories = [
  createEqualityNode,
  createSymbolicContext,
  createParseEquation,
  createEquationSymbols,
  createSymbolicKernel,
  createIsolateEquation,
  createPolynomialSolve,
  createSolveEquation,
  createSolveEquationForAll,
  createCanonicalizeParametricFamilies,
  createInstantiateFamily,
  createMaterializeSolutions,
  createVerifyParametricFamily,
  createTrigonometricSolve,
  createCompoundTrigonometricSolve,
  createNumericSolve
] as const;

export function importsymbolicjs(math: MathJsInstance): symbolicjsInstance {
  math.import([...symbolicjsFactories]);
  return math as symbolicjsInstance;
}
