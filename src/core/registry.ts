export type SymbolicOperatorProperty =
  | 'always'
  | 'scalar'
  | 'never'
  | 'unknown';

export interface OperatorSemantics {
  readonly name: string;
  readonly symbol: string;
  readonly arities: readonly number[];
  readonly commutative: SymbolicOperatorProperty;
  readonly associative: SymbolicOperatorProperty;
}

export interface FunctionSemantics {
  readonly name: string;
  readonly minimumArguments: number;
  readonly maximumArguments: number;
}

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
    associative: value.associative
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
    maximumArguments
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
    commutative: 'scalar', associative: 'scalar'
  }),
  Object.freeze({
    name: 'subtract', symbol: '-', arities: Object.freeze([2]),
    commutative: 'never', associative: 'never'
  }),
  Object.freeze({
    name: 'unaryMinus', symbol: '-', arities: Object.freeze([1]),
    commutative: 'never', associative: 'never'
  }),
  Object.freeze({
    name: 'multiply', symbol: '*', arities: Object.freeze([2]),
    commutative: 'scalar', associative: 'scalar'
  }),
  Object.freeze({
    name: 'divide', symbol: '/', arities: Object.freeze([2]),
    commutative: 'never', associative: 'never'
  }),
  Object.freeze({
    name: 'pow', symbol: '^', arities: Object.freeze([2]),
    commutative: 'never', associative: 'never'
  })
]);

const UNARY_FUNCTIONS: readonly string[] = Object.freeze([
  'abs',
  'acos',
  'asin',
  'atan',
  'cos',
  'cot',
  'csc',
  'exp',
  'log10',
  'sec',
  'sin',
  'sqrt',
  'tan'
]);

const DEFAULT_FUNCTIONS: readonly FunctionSemantics[] = Object.freeze([
  ...UNARY_FUNCTIONS.map<FunctionSemantics>((functionName) => Object.freeze({
    name: functionName,
    minimumArguments: 1,
    maximumArguments: 1
  })),
  Object.freeze({name: 'atan2', minimumArguments: 2, maximumArguments: 2}),
  Object.freeze({name: 'log', minimumArguments: 1, maximumArguments: 2}),
  Object.freeze({name: 'nthRoot', minimumArguments: 1, maximumArguments: 2})
]);

export function createDefaultSymbolicRegistry(): SymbolicRegistry {
  return new SymbolicRegistry(DEFAULT_OPERATORS, DEFAULT_FUNCTIONS);
}
