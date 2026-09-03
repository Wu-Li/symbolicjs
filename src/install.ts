import type {MathJsInstance} from 'mathjs';
import {createEqualityNode} from './equality-node.js';
import {createParseEquation} from './parse-equation.js';
import type {symbolicjsInstance} from './types.js';

export const symbolicjsFactories = [
  createEqualityNode,
  createParseEquation
] as const;

export function importsymbolicjs(math: MathJsInstance): symbolicjsInstance {
  math.import([...symbolicjsFactories]);
  return math as symbolicjsInstance;
}
