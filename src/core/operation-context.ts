import type {MathNode} from 'mathjs';
import type {Assumption} from './assumptions.js';
import {AssumptionSet} from './assumptions.js';
import type {OperationDomain} from './domains.js';
import {validateOperationDomain} from './domains.js';
import {MathAdapter} from './math-adapter.js';
import {NodeBuilder} from './node-builder.js';
import {SymbolicRegistry} from './registry.js';

export type OperationMode = 'strict' | 'conditional';
export type SymbolicDomainPlaceholder = OperationDomain;
export type OperationAssumptions = AssumptionSet | Iterable<Assumption>;

export interface OperationLimitExceeded {
  readonly kind: 'limit';
  readonly limit: string;
  readonly used: number;
  readonly maximum: number;
}

export interface OperationTraceStep {
  readonly stage: string;
  readonly rule: string;
  readonly outcome?: string;
}

export interface OperationContextOptions {
  readonly assumptions?: OperationAssumptions;
  readonly scope?: Readonly<Record<string, unknown>>;
  readonly domain?: OperationDomain;
  readonly limits?: Readonly<Record<string, number>>;
  readonly mode?: OperationMode;
  readonly diagnostics?: boolean;
}

function nonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

function nonempty(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a nonempty string`);
  }
  return value;
}

export function normalizeAssumptions(
  assumptions?: OperationAssumptions
): AssumptionSet {
  if (assumptions === undefined) {
    return new AssumptionSet();
  }
  return assumptions instanceof AssumptionSet
    ? assumptions
    : new AssumptionSet(assumptions);
}

function normalizedScope(
  scope: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new TypeError('Operation scope must be an object');
  }
  return Object.freeze({...scope});
}

/** Operation-neutral deterministic counters and limits. */
export class OperationBudget {
  readonly limits: Readonly<Record<string, number>>;
  readonly #used = new Map<string, number>();

  constructor(limits: Readonly<Record<string, number>> = {}) {
    const normalized: Record<string, number> = {};
    for (const [limit, maximum] of Object.entries(limits)) {
      normalized[nonempty(limit, 'Operation limit name')] = nonnegativeInteger(
        maximum,
        `Operation limit "${limit}"`
      );
    }
    this.limits = Object.freeze(normalized);
    Object.freeze(this);
  }

  check(limit: string, used: number): OperationLimitExceeded | null {
    nonempty(limit, 'Operation limit name');
    nonnegativeInteger(used, 'Operation limit usage');
    const maximum = this.limits[limit];
    return maximum !== undefined && used > maximum
      ? Object.freeze({kind: 'limit', limit, used, maximum})
      : null;
  }

  consume(limit: string, amount = 1): OperationLimitExceeded | null {
    nonempty(limit, 'Operation limit name');
    nonnegativeInteger(amount, 'Operation limit amount');
    const used = (this.#used.get(limit) ?? 0) + amount;
    this.#used.set(limit, used);
    return this.check(limit, used);
  }

  usage(limit: string): number {
    nonempty(limit, 'Operation limit name');
    return this.#used.get(limit) ?? 0;
  }

  snapshot(): Readonly<Record<string, number>> {
    return Object.freeze(Object.fromEntries(
      [...this.#used.entries()].sort(([left], [right]) => left.localeCompare(right))
    ));
  }
}

/**
 * Immutable public operation state with operation-local mutable counters, trace,
 * and memoization hidden behind deterministic methods.
 */
export class OperationContext {
  readonly math: MathAdapter;
  readonly nodes: NodeBuilder;
  readonly registry: SymbolicRegistry;
  readonly assumptions: AssumptionSet;
  readonly scope: Readonly<Record<string, unknown>>;
  readonly domain: OperationDomain;
  readonly limits: Readonly<Record<string, number>>;
  readonly mode: OperationMode;
  readonly diagnostics: boolean;

  readonly #budget: OperationBudget;
  readonly #memo = new WeakMap<MathNode, Map<string, unknown>>();
  readonly #trace: OperationTraceStep[] = [];

  constructor(
    math: MathAdapter,
    registry: SymbolicRegistry,
    options: OperationContextOptions = {}
  ) {
    this.math = math;
    this.nodes = new NodeBuilder(math);
    this.registry = registry;
    this.assumptions = normalizeAssumptions(options.assumptions);
    this.scope = normalizedScope(options.scope);
    this.domain = validateOperationDomain(options.domain ?? 'unknown');
    this.mode = options.mode ?? 'strict';
    this.diagnostics = options.diagnostics ?? false;
    this.#budget = new OperationBudget(options.limits);
    this.limits = this.#budget.limits;
    Object.freeze(this);
  }

  check(limit: string, used: number): OperationLimitExceeded | null {
    return this.#budget.check(limit, used);
  }

  consume(limit: string, amount = 1): OperationLimitExceeded | null {
    return this.#budget.consume(limit, amount);
  }

  usage(limit: string): number {
    return this.#budget.usage(limit);
  }

  usageSnapshot(): Readonly<Record<string, number>> {
    return this.#budget.snapshot();
  }

  memoize<T>(node: MathNode, key: string, create: () => T): T {
    if (!this.math.isNode(node)) {
      throw new TypeError('MathJS node expected for memoization');
    }
    nonempty(key, 'Memoization key');
    if (typeof create !== 'function') {
      throw new TypeError('Memoization factory must be a function');
    }
    let values = this.#memo.get(node);
    if (!values) {
      values = new Map();
      this.#memo.set(node, values);
    }
    if (values.has(key)) {
      return values.get(key) as T;
    }
    const value = create();
    values.set(key, value);
    return value;
  }

  trace(step: OperationTraceStep): void {
    if (!this.diagnostics) {
      return;
    }
    nonempty(step.stage, 'Trace stage');
    nonempty(step.rule, 'Trace rule');
    this.#trace.push(Object.freeze({...step}));
  }

  traceSnapshot(): readonly OperationTraceStep[] {
    return Object.freeze([...this.#trace]);
  }

  with(options: OperationContextOptions): OperationContext {
    const assumptions = options.assumptions === undefined
      ? this.assumptions
      : this.assumptions.withAll(normalizeAssumptions(options.assumptions).entries());
    return new OperationContext(this.math, this.registry, {
      assumptions,
      scope: {...this.scope, ...options.scope},
      domain: options.domain ?? this.domain,
      limits: {...this.limits, ...options.limits},
      mode: options.mode ?? this.mode,
      diagnostics: options.diagnostics ?? this.diagnostics
    });
  }
}
