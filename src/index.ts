export {
  EQUALITY_NODE_NAME,
  EQUALITY_OPERATOR
} from './constants.js';
export {
  createEqualityNode,
  isEqualityNode
} from './equality-node.js';
export {
  createParseEquation,
  splitEquation
} from './parse-equation.js';
export {
  symbolicjsFactories,
  importsymbolicjs
} from './install.js';
export type {
  symbolicjsInstance,
  EqualityNode,
  EqualityNodeConstructor,
  EqualityNodeJSON
} from './types.js';
