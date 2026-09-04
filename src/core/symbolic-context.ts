import {customFactory} from '../custom-factory.js';
import {MathAdapter} from './math-adapter.js';
import type {MathAdapterDependencies} from './math-adapter.js';
import {NodeBuilder} from './node-builder.js';
import {OperationContext} from './operation-context.js';
import type {
  OperationContextOptions,
  OperationMode,
  SymbolicDomainPlaceholder
} from './operation-context.js';
import {
  createDefaultSymbolicRegistry,
  SymbolicRegistry
} from './registry.js';

export interface SymbolicContextOptions {
  readonly registry?: SymbolicRegistry;
  readonly operationDefaults?: OperationContextOptions;
}

interface NormalizedOperationContextOptions {
  readonly assumptions: Readonly<Record<string, unknown>>;
  readonly domain: SymbolicDomainPlaceholder;
  readonly limits: Readonly<Record<string, number>>;
  readonly mode: OperationMode;
  readonly diagnostics: boolean;
}

function normalizedOperationOptions(
  supplied: OperationContextOptions = {}
): NormalizedOperationContextOptions {
  return Object.freeze({
    assumptions: Object.freeze({...supplied.assumptions}),
    domain: supplied.domain ?? 'unknown',
    limits: Object.freeze({...supplied.limits}),
    mode: supplied.mode ?? 'strict',
    diagnostics: supplied.diagnostics ?? false
  });
}

function mergeOperationOptions(
  defaults: NormalizedOperationContextOptions,
  supplied: OperationContextOptions
): NormalizedOperationContextOptions {
  return normalizedOperationOptions({
    assumptions: {...defaults.assumptions, ...supplied.assumptions},
    domain: supplied.domain ?? defaults.domain,
    limits: {...defaults.limits, ...supplied.limits},
    mode: supplied.mode ?? defaults.mode,
    diagnostics: supplied.diagnostics ?? defaults.diagnostics
  });
}

/** Experimental MathJS-native entry point for the generalized symbolic layer. */
export class SymbolicContext {
  readonly math: MathAdapter;
  readonly nodes: NodeBuilder;
  readonly registry: SymbolicRegistry;
  readonly #operationDefaults: NormalizedOperationContextOptions;

  constructor(
    math: MathAdapter,
    registry = createDefaultSymbolicRegistry(),
    operationDefaults: OperationContextOptions = {}
  ) {
    this.math = math;
    this.nodes = new NodeBuilder(math);
    this.registry = registry;
    this.#operationDefaults = normalizedOperationOptions(operationDefaults);
    Object.freeze(this);
  }

  operation(options: OperationContextOptions = {}): OperationContext {
    return new OperationContext(
      this.math,
      this.registry,
      mergeOperationOptions(this.#operationDefaults, options)
    );
  }

  with(options: SymbolicContextOptions = {}): SymbolicContext {
    return new SymbolicContext(
      this.math,
      options.registry ?? this.registry,
      mergeOperationOptions(
        this.#operationDefaults,
        options.operationDefaults ?? {}
      )
    );
  }
}

/** Exact supported MathJS factory boundary for the Chapter 1 symbolic substrate. */
export const SYMBOLIC_MATHJS_DEPENDENCIES = Object.freeze([
  'ConstantNode',
  'EqualityNode',
  'FunctionNode',
  'OperatorNode',
  'SymbolNode',
  'mathWithTransform',
  'parse',
  'reviver'
]);

export const createSymbolicContext = customFactory(
  'symbolic',
  [...SYMBOLIC_MATHJS_DEPENDENCIES],
  (rawDependencies) => new SymbolicContext(
    new MathAdapter(rawDependencies as unknown as MathAdapterDependencies)
  )
);
