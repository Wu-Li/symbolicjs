import type {MathJsInstance} from 'mathjs';
import {createEqualityNode} from './equality-node.js';
import {createParseEquation} from './parse-equation.js';
import type {CasJsInstance} from './types.js';

export const casjsFactories = [
  createEqualityNode,
  createParseEquation
] as const;

export function importCasjs(math: MathJsInstance): CasJsInstance {
  math.import([...casjsFactories]);
  return math as CasJsInstance;
}
