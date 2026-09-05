import {isFunctionNode, isSymbolNode} from 'mathjs';
import type {MathNode} from 'mathjs';

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

export type ConfiguredNameLookup = (name: string) => boolean;

/**
 * Discover free symbol names without treating a FunctionNode's callee as a
 * variable. A configured MathJS instance can additionally identify imported
 * constants through `hasConfiguredName`.
 */
export function discoverFreeSymbols(
  node: MathNode,
  hasConfiguredName?: ConfiguredNameLookup
): readonly string[] {
  if (!node?.isNode) {
    throw new TypeError('MathJS node expected for free-symbol discovery');
  }
  const symbols = new Set<string>();
  node.traverse((candidate, path, parent) => {
    if (!isSymbolNode(candidate)) {
      return;
    }
    if (parent && isFunctionNode(parent) && path === 'fn') {
      return;
    }
    if (
      !BUILTIN_CONSTANTS.has(candidate.name) &&
      !hasConfiguredName?.(candidate.name)
    ) {
      symbols.add(candidate.name);
    }
  });
  return Object.freeze([...symbols].sort());
}
