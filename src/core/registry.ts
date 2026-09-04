export type SymbolicOperatorProperty =
  | 'always'
  | 'scalar'
  | 'never'
  | 'unknown';

export type OperatorSemantic =
  | 'addition'
  | 'subtraction'
  | 'negation'
  | 'multiplication'
  | 'division'
  | 'power'
  | 'opaque';

export type FunctionSemantic =
  | 'absolute'
  | 'circular'
  | 'inverse-circular'
  | 'exponential'
  | 'logarithm'
  | 'nth-root'
  | 'square-root'
  | 'opaque';

export interface OperatorSemantics {
  readonly name: string;
  readonly symbol: string;
  readonly arities: readonly number[];
  readonly commutative: SymbolicOperatorProperty;
  readonly associative: SymbolicOperatorProperty;
  readonly semantic?: OperatorSemantic;
}

export interface FunctionSemantics {
  readonly name: string;
  readonly minimumArguments: number;
  readonly maximumArguments: number;
  readonly semantic?: FunctionSemantic;
}

const OPERATOR_SEMANTICS = new Set<OperatorSemantic>([
  'addition',
  'subtraction',
  'negation',
  'multiplication',
  'division',
  'power',
  'opaque'
]);

const FUNCTION_SEMANTICS = new Set<FunctionSemantic>([
  'absolute',
  'circular',
  'inverse-circular',
  'exponential',
  'logarithm',
  'nth-root',
  'square-root',
  'opaque'
]);

function name(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a nonempty string`);
  }
  return value;
}

function nonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

function operatorSemantic(value: OperatorSemantic | undefined): OperatorSemantic {
  const semantic = value ?? 'opaque';
  if (!OPERATOR_SEMANTICS.has(semantic)) {
    throw new TypeError('Unknown operator semantic');
  }
  return semantic;
}

function functionSemantic(value: FunctionSemantic | undefined): FunctionSemantic {
  const semantic = value ?? 'opaque';
  if (!FUNCTION_SEMANTICS.has(semantic)) {
    throw new TypeError('Unknown function semantic');
  }
  return semantic;
}

function freezeOperator(value: OperatorSemantics): OperatorSemantics {
  const arities = [...value.arities].map((arity) =>
    nonnegativeInteger(arity, `Operator ${value.name} arity`)
  );
  if (arities.length === 0) {
    throw new TypeError(`Operator ${value.name} must declare at least one arity`);
  }
  return Object.freeze({
    name: name(value.name, 'Operator name'),
    symbol: name(value.symbol, 'Operator symbol'),
    arities: Object.freeze([...new Set(arities)].sort((left, right) => left - right)),
    commutative: value.commutative,
    associative: value.associative,
    semantic: operatorSemantic(value.semantic)
  });
}

function freezeFunction(value: FunctionSemantics): FunctionSemantics {
  const minimumArguments = nonnegativeInteger(
    value.minimumArguments,
    `Function ${value.name} minimumArguments`
  );
  const maximumArguments = nonnegativeInteger(
    value.maximumArguments,
    `Function ${value.name} maximumArguments`
  );
  if (maximumArguments < minimumArguments) {
    throw new RangeError(`Function ${value.name} argument range is reversed`);
  }
  return Object.freeze({
    name: name(value.name, 'Function name'),
    minimumArguments,
    maximumArguments,
    semantic: functionSemantic(value.semantic)
  });
}

/** Immutable, persistent symbolic metadata scoped to one SymbolicContext. */
export class SymbolicRegistry {
  readonly #operators: ReadonlyMap<string, OperatorSemantics>;
  readonly #functions: ReadonlyMap<string, FunctionSemantics>;

  constructor(
    operators: Iterable<OperatorSemantics> = [],
    functions: Iterable<FunctionSemantics> = []
  ) {
    this.#operators = new Map(
      [...operators].map((operator) => {
        const frozen = freezeOperator(operator);
        return [frozen.name, frozen] as const;
      })
    );
    this.#functions = new Map(
      [...functions].map((fn) => {
        const frozen = freezeFunction(fn);
        return [frozen.name, frozen] as const;
      })
    );
    Object.freeze(this);
  }

  getOperator(name: string): OperatorSemantics | undefined {
    return this.#operators.get(name);
  }

  getFunction(name: string): FunctionSemantics | undefined {
    return this.#functions.get(name);
  }

  operatorNames(): readonly string[] {
    return Object.freeze([...this.#operators.keys()].sort());
  }

  functionNames(): readonly string[] {
    return Object.freeze([...this.#functions.keys()].sort());
  }

  withOperator(operator: OperatorSemantics): SymbolicRegistry {
    const frozen = freezeOperator(operator);
    return new SymbolicRegistry(
      [
        ...[...this.#operators.values()].filter((entry) => entry.name !== frozen.name),
        frozen
      ],
      this.#functions.values()
    );
  }

  withFunction(fn: FunctionSemantics): SymbolicRegistry {
    const frozen = freezeFunction(fn);
    return new SymbolicRegistry(
      this.#operators.values(),
      [
        ...[...this.#functions.values()].filter((entry) => entry.name !== frozen.name),
        frozen
      ]
    );
  }
}

const DEFAULT_OPERATORS: readonly OperatorSemantics[] = Object.freeze([
  Object.freeze({
    name: 'add', symbol: '+', arities: Object.freeze([2]),
    commutative: 'scalar', associative: 'scalar', semantic: 'addition'
  }),
  Object.freeze({
    name: 'subtract', symbol: '-', arities: Object.freeze([2]),
    commutative: 'never', associative: 'never', semantic: 'subtraction'
  }),
  Object.freeze({
    name: 'unaryMinus', symbol: '-', arities: Object.freeze([1]),
    commutative: 'never', associative: 'never', semantic: 'negation'
  }),
  Object.freeze({
    name: 'multiply', symbol: '*', arities: Object.freeze([2]),
    commutative: 'scalar', associative: 'scalar', semantic: 'multiplication'
  }),
  Object.freeze({
    name: 'divide', symbol: '/', arities: Object.freeze([2]),
    commutative: 'never', associative: 'never', semantic: 'division'
  }),
  Object.freeze({
    name: 'pow', symbol: '^', arities: Object.freeze([2]),
    commutative: 'never', associative: 'never', semantic: 'power'
  })
]);

const DEFAULT_FUNCTIONS: readonly FunctionSemantics[] = Object.freeze([
  Object.freeze({
    name: 'abs', minimumArguments: 1, maximumArguments: 1,
    semantic: 'absolute'
  }),
  ...['acos', 'asin', 'atan'].map<FunctionSemantics>((functionName) => Object.freeze({
    name: functionName,
    minimumArguments: 1,
    maximumArguments: 1,
    semantic: 'inverse-circular'
  })),
  ...['cos', 'cot', 'csc', 'sec', 'sin', 'tan'].map<FunctionSemantics>(
    (functionName) => Object.freeze({
      name: functionName,
      minimumArguments: 1,
      maximumArguments: 1,
      semantic: 'circular'
    })
  ),
  Object.freeze({
    name: 'atan2', minimumArguments: 2, maximumArguments: 2,
    semantic: 'circular'
  }),
  Object.freeze({
    name: 'exp', minimumArguments: 1, maximumArguments: 1,
    semantic: 'exponential'
  }),
  Object.freeze({
    name: 'log', minimumArguments: 1, maximumArguments: 2,
    semantic: 'logarithm'
  }),
  Object.freeze({
    name: 'log10', minimumArguments: 1, maximumArguments: 1,
    semantic: 'logarithm'
  }),
  Object.freeze({
    name: 'nthRoot', minimumArguments: 1, maximumArguments: 2,
    semantic: 'nth-root'
  }),
  Object.freeze({
    name: 'sqrt', minimumArguments: 1, maximumArguments: 1,
    semantic: 'square-root'
  })
]);

export function createDefaultSymbolicRegistry(): SymbolicRegistry {
  return new SymbolicRegistry(DEFAULT_OPERATORS, DEFAULT_FUNCTIONS);
}
