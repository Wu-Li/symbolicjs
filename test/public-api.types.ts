import {all, create} from 'mathjs';
import {
  EQUALITY_NODE_NAME,
  EQUALITY_OPERATOR,
  createEqualityNode,
  createEquationSymbols,
  createParseEquation,
  createSolveEquation,
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
const verification = math.symbolicKernel.verify(equation, 'x', math.parse('1'));

void EQUALITY_NODE_NAME;
void EQUALITY_OPERATOR;
void createEqualityNode;
void createEquationSymbols;
void createParseEquation;
void createSolveEquation;
void createSymbolicKernel;
void constructor;
void isEqualityNode(json);
void equationSymbols(equation);
void result;
void verification;
void splitEquation('x =:= 1');
void symbolicjsFactories;
