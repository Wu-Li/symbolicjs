import {all, create} from 'mathjs';
import {
  EQUALITY_NODE_NAME,
  EQUALITY_OPERATOR,
  createEqualityNode,
  createEquationSymbols,
  createIsolateEquation,
  createPolynomialSolve,
  createParseEquation,
  createSolveEquation,
  createSolveEquationForAll,
  createSymbolicKernel,
  equationSymbols,
  importsymbolicjs,
  isEqualityNode,
  splitEquation,
  symbolicjsFactories
} from '../src/index.js';
import type {
  EqualityNode,
  EqualityNodeConstructor,
  EqualityNodeJSON,
  SolveResult,
  symbolicjsInstance
} from '../src/index.js';

const math: symbolicjsInstance = importsymbolicjs(create(all!));
const equation: EqualityNode = math.parseEquation('x =:= 1');
const constructor: EqualityNodeConstructor = math.EqualityNode;
const json: EqualityNodeJSON = equation.toJSON();
const result: SolveResult = math.solveEquation(equation, 'x');
const allResults: ReadonlyMap<string, SolveResult> = math.solveEquationForAll(equation);
const verification = math.symbolicKernel.verify(equation, 'x', math.parse('1'));

void EQUALITY_NODE_NAME;
void EQUALITY_OPERATOR;
void createEqualityNode;
void createEquationSymbols;
void createIsolateEquation;
void createPolynomialSolve;
void createParseEquation;
void createSolveEquation;
void createSolveEquationForAll;
void createSymbolicKernel;
void constructor;
void isEqualityNode(json);
void equationSymbols(equation);
void result;
void allResults;
void verification;
void splitEquation('x =:= 1');
void symbolicjsFactories;
