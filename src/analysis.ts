import {isFunctionNode, isSymbolNode} from 'mathjs';
import type {MathNode} from 'mathjs';
import {customFactory} from './custom-factory.js';
import type {EqualityNode} from './types.js';

const BUILTIN_CONSTANTS = new Set([
  'e',
  'false',
  'i',
  'Infinity',
  'NaN',
  'null',
  'phi',
  'pi',
  'SQRT1_2',
  'SQRT2',
  'tau',
  'true',
  'undefined',
  'version'
]);

function collectSymbols(node: MathNode, symbols: Set<string>): void {
  node.traverse((candidate, path, parent) => {
    if (!isSymbolNode(candidate)) {
      return;
    }
    if (parent && isFunctionNode(parent) && path === 'fn') {
      return;
    }
    if (!BUILTIN_CONSTANTS.has(candidate.name)) {
      symbols.add(candidate.name);
    }
  });
}

export function equationSymbols(equation: EqualityNode): readonly string[] {
  if (!equation?.isEqualityNode) {
    throw new TypeError('EqualityNode expected');
  }
  const symbols = new Set<string>();
  collectSymbols(equation.lhs, symbols);
  collectSymbols(equation.rhs, symbols);
  return Object.freeze([...symbols].sort());
}

export const createEquationSymbols = customFactory(
  'equationSymbols',
  [],
  () => equationSymbols
);
