import type {MathNode} from 'mathjs';
import {MathAdapter} from './math-adapter.js';
import {NodeBuilder} from './node-builder.js';
import {SymbolicRegistry} from './registry.js';

export type OperationMode = 'strict' | 'conditional';
export type SymbolicDomainPlaceholder = 'unknown' | 'real' | 'complex';

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
  readonly assumptions?: Readonly<Record<string, unknown>>;
  readonly domain?: SymbolicDomainPlaceholder;
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
  readonly assumptions: Readonly<Record<string, unknown>>;
  readonly domain: SymbolicDomainPlaceholder;
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
    this.assumptions = Object.freeze({...options.assumptions});
    this.domain = options.domain ?? 'unknown';
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
    return new OperationContext(this.math, this.registry, {
      assumptions: {...this.assumptions, ...options.assumptions},
      domain: options.domain ?? this.domain,
      limits: {...this.limits, ...options.limits},
      mode: options.mode ?? this.mode,
      diagnostics: options.diagnostics ?? this.diagnostics
    });
  }
}
