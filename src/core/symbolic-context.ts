import type {MathNode} from 'mathjs';
import {AlgebraEngine} from '../algebra/engine.js';
import {customFactory} from '../custom-factory.js';
import {
  CanonicalizationEngine,
  normalizeCanonicalizationOptions
} from './canonicalize/engine.js';
import type {
  CanonicalizationOptions,
  CanonicalizationProfile,
  CanonicalizationResult
} from './canonicalize/types.js';
import type {Assumption} from './assumptions.js';
import {AssumptionSet} from './assumptions.js';
import {DefinednessAnalyzer} from './definedness.js';
import type {DefinednessAnalysisOptions} from './definedness.js';
import type {OperationDomain} from './domains.js';
import {validateOperationDomain} from './domains.js';
import {MathAdapter} from './math-adapter.js';
import type {MathAdapterDependencies} from './math-adapter.js';
import {PatternMatcher} from './matcher.js';
import type {PatternMatchResult} from './matcher.js';
import {NodeBuilder} from './node-builder.js';
import {
  normalizeAssumptions,
  OperationContext
} from './operation-context.js';
import type {
  OperationContextOptions,
  OperationMode
} from './operation-context.js';
import type {Pattern} from './pattern.js';
import {
  createJudgment,
  PredicateFactory
} from './predicate.js';
import type {
  Judgment,
  RequirementResult,
  SymbolicEvidence,
  SymbolicPredicate
} from './predicate.js';
import {
  createDefaultSymbolicRegistry,
  SymbolicRegistry
} from './registry.js';
import {RewriteEngine} from './rewrite-engine.js';
import type {RewriteOptions, RewriteStrategy, TransformResult} from './rewrite.js';
import {PredicateEngine} from './semantic-engine.js';
import {StructuralEngine} from './structure.js';

export interface SymbolicContextOptions {
  readonly registry?: SymbolicRegistry;
  readonly operationDefaults?: OperationContextOptions;
}

export interface DefinednessQueryOptions extends OperationContextOptions {
  readonly includeLeafDefinedness?: boolean;
  readonly legacySolverCompatibility?: boolean;
}

interface NormalizedOperationContextOptions {
  readonly assumptions: AssumptionSet;
  readonly scope: Readonly<Record<string, unknown>>;
  readonly domain: OperationDomain;
  readonly limits: Readonly<Record<string, number>>;
  readonly mode: OperationMode;
  readonly diagnostics: boolean;
}

function normalizedScope(
  scope: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new TypeError('Operation scope must be an object');
  }
  return Object.freeze({...scope});
}

function normalizedOperationOptions(
  supplied: OperationContextOptions = {}
): NormalizedOperationContextOptions {
  return Object.freeze({
    assumptions: normalizeAssumptions(supplied.assumptions),
    scope: normalizedScope(supplied.scope),
    domain: validateOperationDomain(supplied.domain ?? 'unknown'),
    limits: Object.freeze({...supplied.limits}),
    mode: supplied.mode ?? 'strict',
    diagnostics: supplied.diagnostics ?? false
  });
}

function mergeOperationOptions(
  defaults: NormalizedOperationContextOptions,
  supplied: OperationContextOptions
): NormalizedOperationContextOptions {
  const assumptions = supplied.assumptions === undefined
    ? defaults.assumptions
    : defaults.assumptions.withAll(normalizeAssumptions(supplied.assumptions).entries());
  const scope = supplied.scope === undefined
    ? defaults.scope
    : {...defaults.scope, ...normalizedScope(supplied.scope)};
  return normalizedOperationOptions({
    assumptions,
    scope,
    domain: supplied.domain ?? defaults.domain,
    limits: {...defaults.limits, ...supplied.limits},
    mode: supplied.mode ?? defaults.mode,
    diagnostics: supplied.diagnostics ?? defaults.diagnostics
  });
}

function canonicalizationDomain(
  profile: CanonicalizationProfile,
  supplied: OperationDomain | undefined
): OperationDomain | undefined {
  if (profile === 'real-algebraic') {
    if (supplied !== undefined && supplied !== 'real') {
      throw new RangeError('real-algebraic canonicalization requires the real domain');
    }
    return 'real';
  }
  if (profile === 'complex-safe') {
    if (supplied !== undefined && supplied !== 'complex') {
      throw new RangeError('complex-safe canonicalization requires the complex domain');
    }
    return 'complex';
  }
  return supplied === undefined ? undefined : validateOperationDomain(supplied);
}

/** Experimental MathJS-native entry point for the generalized symbolic layer. */
export class SymbolicContext {
  readonly math: MathAdapter;
  readonly nodes: NodeBuilder;
  readonly registry: SymbolicRegistry;
  readonly predicates: PredicateFactory;
  readonly structure: StructuralEngine;
  readonly canonicalization: CanonicalizationEngine;
  readonly algebra: AlgebraEngine;
  readonly matcher: PatternMatcher;
  readonly rewrite: RewriteEngine;
  readonly #definedness: DefinednessAnalyzer;
  readonly #semantics: PredicateEngine;
  readonly #operationDefaults: NormalizedOperationContextOptions;

  constructor(
    math: MathAdapter,
    registry = createDefaultSymbolicRegistry(),
    operationDefaults: OperationContextOptions = {}
  ) {
    this.math = math;
    this.nodes = new NodeBuilder(math);
    this.registry = registry;
    this.predicates = new PredicateFactory(math);
    this.structure = new StructuralEngine(math);
    this.#operationDefaults = normalizedOperationOptions(operationDefaults);
    this.#definedness = new DefinednessAnalyzer(
      math,
      this.nodes,
      this.predicates,
      registry
    );
    this.#semantics = new PredicateEngine(
      math,
      this.predicates,
      registry,
      this.#definedness
    );
    this.canonicalization = new CanonicalizationEngine(
      math,
      this.nodes,
      this.predicates,
      this.#semantics,
      this.#definedness,
      this.structure
    );
    this.algebra = new AlgebraEngine(
      math,
      this.nodes,
      this.predicates,
      this.#semantics,
      this.#definedness,
      this.structure,
      this.canonicalization,
      (options = {}) => new OperationContext(
        this.math,
        this.registry,
        mergeOperationOptions(this.#operationDefaults, options)
      )
    );
    this.matcher = new PatternMatcher(
      this.structure,
      this.#semantics,
      this.algebra
    );
    this.rewrite = new RewriteEngine(this.matcher, this.structure);
    Object.freeze(this);
  }

  assumptions(entries: Iterable<Assumption> = []): AssumptionSet {
    return new AssumptionSet(entries);
  }

  operation(options: OperationContextOptions = {}): OperationContext {
    return new OperationContext(
      this.math,
      this.registry,
      mergeOperationOptions(this.#operationDefaults, options)
    );
  }

  ask(
    predicate: SymbolicPredicate,
    options: OperationContextOptions = {}
  ): Judgment {
    return this.#semantics.ask(predicate, this.operation(options));
  }

  require(
    predicate: SymbolicPredicate,
    options: OperationContextOptions = {}
  ): RequirementResult {
    return this.#semantics.require(predicate, this.operation(options));
  }

  match(
    node: MathNode,
    pattern: Pattern,
    options: OperationContextOptions = {}
  ): PatternMatchResult {
    return this.matcher.match(node, pattern, this.operation(options));
  }

  /**
   * Apply a bounded rewrite strategy. MathJS reserves a factory result's
   * `transform` property for parser transforms, so the instance-local symbolic
   * service deliberately uses a non-reserved method name.
   */
  rewriteExpression(
    node: MathNode,
    strategy: RewriteStrategy,
    options: RewriteOptions = {}
  ): TransformResult {
    return this.rewrite.transform(node, strategy, this.operation(options), options);
  }

  canonicalize(
    node: MathNode,
    options: CanonicalizationOptions = {}
  ): CanonicalizationResult {
    const normalized = normalizeCanonicalizationOptions(options);
    const domain = canonicalizationDomain(normalized.profile, options.domain);
    const canonicalSteps = Math.min(
      normalized.maximumSteps,
      this.#operationDefaults.limits.canonicalSteps ?? normalized.maximumSteps,
      options.limits?.canonicalSteps ?? normalized.maximumSteps
    );
    const operation = this.operation({
      ...(options.assumptions === undefined
        ? {}
        : {assumptions: options.assumptions}),
      ...(options.scope === undefined ? {} : {scope: options.scope}),
      ...(domain === undefined ? {} : {domain}),
      limits: {...options.limits, canonicalSteps},
      ...(options.mode === undefined ? {} : {mode: options.mode}),
      ...(options.diagnostics === undefined
        ? {}
        : {diagnostics: options.diagnostics})
    });
    return normalized.profile === 'polynomial' || normalized.profile === 'rational'
      ? this.algebra.canonicalizeProfile(
        node,
        operation,
        normalized,
        options.generators
      )
      : this.canonicalization.canonicalize(node, operation, normalized);
  }

  definedness(
    node: MathNode,
    options: DefinednessQueryOptions = {}
  ): Judgment {
    const operation = this.operation(options);
    const analysisOptions: DefinednessAnalysisOptions = {
      domain: operation.domain,
      ...(options.includeLeafDefinedness === undefined
        ? {}
        : {includeLeafDefinedness: options.includeLeafDefinedness}),
      ...(options.legacySolverCompatibility === undefined
        ? {}
        : {legacySolverCompatibility: options.legacySolverCompatibility})
    };
    const requirements = this.#definedness.requirements(node, analysisOptions);
    const unresolved = new Map<string, SymbolicPredicate>();
    const evidence: SymbolicEvidence[] = [];

    for (const requirement of requirements) {
      const judgment = this.#semantics.ask(requirement, operation);
      evidence.push(...judgment.evidence);
      if (judgment.truth === 'disproven') {
        return createJudgment('disproven', [requirement], evidence);
      }
      if (judgment.truth === 'unknown') {
        for (const outstanding of judgment.requirements) {
          const qualifier = outstanding.kind === 'domain'
            ? outstanding.domain
            : outstanding.property;
          unresolved.set(
            `${outstanding.kind}:${qualifier}:${outstanding.expression.toString({parenthesis: 'all'})}`,
            outstanding
          );
        }
      }
    }

    return createJudgment(
      unresolved.size === 0 ? 'proven' : 'unknown',
      [...unresolved.values()],
      evidence
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
