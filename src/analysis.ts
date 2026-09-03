import {isFunctionNode, isSymbolNode} from 'mathjs';
import type {MathNode} from 'mathjs';
import {customFactory} from './custom-factory.js';
import type {EqualityNode} from './types.js';

type MathNamespace = Readonly<Record<string, unknown>>;

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

function collectNodeSymbols(
  node: MathNode,
  mathNamespace?: MathNamespace
): readonly string[] {
  const symbols = new Set<string>();
  node.traverse((candidate, path, parent) => {
    if (!isSymbolNode(candidate)) {
      return;
    }
    if (parent && isFunctionNode(parent) && path === 'fn') {
      return;
    }
    const configuredValue = mathNamespace && Object.prototype.hasOwnProperty.call(
      mathNamespace,
      candidate.name
    );
    if (!BUILTIN_CONSTANTS.has(candidate.name) && !configuredValue) {
      symbols.add(candidate.name);
    }
  });
  return Object.freeze([...symbols].sort());
}

export function nodeSymbols(node: MathNode): readonly string[] {
  return collectNodeSymbols(node);
}

export function equationSymbols(equation: EqualityNode): readonly string[] {
  if (!equation?.isEqualityNode) {
    throw new TypeError('EqualityNode expected');
  }
  return Object.freeze([
    ...new Set([...nodeSymbols(equation.lhs), ...nodeSymbols(equation.rhs)])
  ].sort());
}

function configuredEquationSymbols(
  equation: EqualityNode,
  mathNamespace: MathNamespace
): readonly string[] {
  if (!equation?.isEqualityNode) {
    throw new TypeError('EqualityNode expected');
  }
  return Object.freeze([
    ...new Set([
      ...collectNodeSymbols(equation.lhs, mathNamespace),
      ...collectNodeSymbols(equation.rhs, mathNamespace)
    ])
  ].sort());
}

export const createEquationSymbols = customFactory(
  'equationSymbols',
  ['mathWithTransform'],
  (dependencies) => {
    const mathNamespace = dependencies.mathWithTransform as MathNamespace;
    return (equation: EqualityNode) => configuredEquationSymbols(
      equation,
      mathNamespace
    );
  }
);
