import {customFactory} from './custom-factory.js';
import type {SolveOptions, SolveResult} from './solve-types.js';
import type {EqualityNode} from './types.js';

interface SolveAllDependencies {
  equationSymbols(equation: EqualityNode): readonly string[];
  parseEquation(source: string): EqualityNode;
  solveEquation(
    equation: EqualityNode,
    target: string,
    options?: SolveOptions
  ): SolveResult;
}

export class ReadonlyResultMap<K, V> implements ReadonlyMap<K, V> {
  readonly #values: Map<K, V>;

  constructor(entries: Iterable<readonly [K, V]>) {
    this.#values = new Map(entries);
    Object.freeze(this);
  }

  get size(): number {
    return this.#values.size;
  }

  get(key: K): V | undefined {
    return this.#values.get(key);
  }

  has(key: K): boolean {
    return this.#values.has(key);
  }

  entries(): MapIterator<[K, V]> {
    return this.#values.entries();
  }

  keys(): MapIterator<K> {
    return this.#values.keys();
  }

  values(): MapIterator<V> {
    return this.#values.values();
  }

  forEach(
    callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
    thisArg?: unknown
  ): void {
    for (const [key, value] of this.#values) {
      callbackfn.call(thisArg, value, key, this);
    }
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  get [Symbol.toStringTag](): string {
    return 'ReadonlyResultMap';
  }
}

export function solveEquationForAll(
  dependencies: SolveAllDependencies,
  equationInput: EqualityNode | string,
  options?: SolveOptions
): ReadonlyMap<string, SolveResult> {
  const equation = typeof equationInput === 'string'
    ? dependencies.parseEquation(equationInput)
    : equationInput;
  if (!equation?.isEqualityNode) {
    throw new TypeError('EqualityNode or equation string expected');
  }
  return new ReadonlyResultMap(dependencies.equationSymbols(equation).map(
    (target) => [
      target,
      dependencies.solveEquation(equation, target, options)
    ] as const
  ));
}

export const createSolveEquationForAll = customFactory(
  'solveEquationForAll',
  ['equationSymbols', 'parseEquation', 'solveEquation'],
  (rawDependencies) => {
    const dependencies = rawDependencies as unknown as SolveAllDependencies;
    return (
      equation: EqualityNode | string,
      options?: SolveOptions
    ) => solveEquationForAll(dependencies, equation, options);
  }
);
