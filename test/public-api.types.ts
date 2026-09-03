import {all, create} from 'mathjs';
import {
  EQUALITY_NODE_NAME,
  EQUALITY_OPERATOR,
  createEqualityNode,
  createParseEquation,
  importsymbolicjs,
  isEqualityNode,
  splitEquation,
  symbolicjsFactories
} from '../src/index.js';
import type {
  EqualityNode,
  EqualityNodeConstructor,
  EqualityNodeJSON,
  symbolicjsInstance
} from '../src/index.js';

const math: symbolicjsInstance = importsymbolicjs(create(all!));
const equation: EqualityNode = math.parseEquation('x =:= 1');
const constructor: EqualityNodeConstructor = math.EqualityNode;
const json: EqualityNodeJSON = equation.toJSON();

void EQUALITY_NODE_NAME;
void EQUALITY_OPERATOR;
void createEqualityNode;
void createParseEquation;
void constructor;
void isEqualityNode(json);
void splitEquation('x =:= 1');
void symbolicjsFactories;
