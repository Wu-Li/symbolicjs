import {all, create} from 'mathjs';
import {
  EQUALITY_NODE_NAME,
  EQUALITY_OPERATOR,
  createEqualityNode,
  createEquationSymbols,
  createParseEquation,
  createSolveEquation,
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

void EQUALITY_NODE_NAME;
void EQUALITY_OPERATOR;
void createEqualityNode;
void createEquationSymbols;
void createParseEquation;
void createSolveEquation;
void constructor;
void isEqualityNode(json);
void equationSymbols(equation);
void result;
void splitEquation('x =:= 1');
void symbolicjsFactories;
