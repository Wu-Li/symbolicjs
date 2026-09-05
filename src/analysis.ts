import type {MathNode} from 'mathjs';
import {discoverFreeSymbols} from './core/free-symbols.js';
import {customFactory} from './custom-factory.js';
import type {EqualityNode} from './types.js';

type MathNamespace = Readonly<Record<string, unknown>>;

export function nodeSymbols(node: MathNode): readonly string[] {
  return discoverFreeSymbols(node);
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
  const configured = (name: string) => Object.prototype.hasOwnProperty.call(
    mathNamespace,
    name
  );
  return Object.freeze([
    ...new Set([
      ...discoverFreeSymbols(equation.lhs, configured),
      ...discoverFreeSymbols(equation.rhs, configured)
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
