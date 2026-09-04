import type {MathNode} from 'mathjs';
import type {
  Condition,
  ParametricFamily,
  SearchScope,
  Solution,
  SolveResult
} from '../../src/index.js';

export type SemanticSolveSummary = Readonly<Record<string, unknown>>;

export interface SemanticSummaryOptions {
  readonly includeExpressionIdentity?: boolean;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)])
    );
  }
  return value;
}

function nodeIdentity(node: MathNode): string {
  return JSON.stringify(canonicalJson(JSON.parse(JSON.stringify(node))));
}

function sortedUnique(values: Iterable<string>): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function conditionKinds(
  entries: readonly {readonly conditions: readonly Condition[]}[]
): readonly string[] {
  return sortedUnique(entries.flatMap((entry) =>
    entry.conditions.map((condition) => condition.kind)
  ));
}

function verificationStatuses(
  entries: readonly {readonly verification: {readonly status: string}}[]
): readonly string[] {
  return sortedUnique(entries.map((entry) => entry.verification.status));
}

function scopeSummary(scope: SearchScope | undefined): Readonly<Record<string, unknown>> | undefined {
  if (scope === undefined) {
    return undefined;
  }
  return Object.freeze({
    domain: scope.domain,
    completeness: scope.completeness,
    ...(scope.interval === undefined ? {} : {
      interval: Object.freeze({...scope.interval})
    })
  });
}

function solutionSummary(
  solutions: readonly Solution[],
  includeExpressionIdentity: boolean
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    solutionCount: solutions.length,
    exactCount: solutions.filter((solution) => solution.exact).length,
    approximateCount: solutions.filter((solution) => !solution.exact).length,
    verificationStatuses: verificationStatuses(solutions),
    conditionKinds: conditionKinds(solutions),
    multiplicityTotal: solutions.reduce(
      (total, solution) => total + (solution.multiplicity ?? 1),
      0
    ),
    ...(includeExpressionIdentity ? {
      valueIdentities: Object.freeze(solutions.map((solution) =>
        nodeIdentity(solution.value)
      ).sort())
    } : {})
  });
}

function familySummary(
  families: readonly ParametricFamily[],
  includeExpressionIdentity: boolean
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    familyCount: families.length,
    exactCount: families.filter((family) => family.exact).length,
    verificationStatuses: verificationStatuses(families),
    conditionKinds: conditionKinds(families),
    parameterDomains: sortedUnique(families.flatMap((family) =>
      family.parameters.map((parameter) => parameter.domain)
    )),
    ...(includeExpressionIdentity ? {
      valueIdentities: Object.freeze(families.map((family) =>
        nodeIdentity(family.value)
      ).sort())
    } : {})
  });
}

/**
 * Produce a stable, order-independent summary of the public mathematical result.
 * Diagnostics, certificates, and expression presentation are deliberately excluded;
 * later migration chapters can strengthen identity without rewriting this baseline.
 */
export function summarizeSolveResult(
  result: SolveResult,
  options: SemanticSummaryOptions = {}
): SemanticSolveSummary {
  const includeExpressionIdentity = options.includeExpressionIdentity ?? true;
  const scope = scopeSummary(result.scope);
  const scoped = scope === undefined ? {} : {scope};

  switch (result.kind) {
    case 'finite':
      return Object.freeze({
        kind: result.kind,
        target: result.target,
        ...solutionSummary(result.solutions, includeExpressionIdentity),
        ...scoped
      });
    case 'parametric':
      return Object.freeze({
        kind: result.kind,
        target: result.target,
        ...familySummary(result.families, includeExpressionIdentity),
        domain: result.domain,
        completeness: result.completeness,
        ...scoped
      });
    case 'identity':
    case 'contradiction':
      return Object.freeze({
        kind: result.kind,
        target: result.target,
        conditionKinds: conditionKinds([result]),
        ...scoped
      });
    case 'partial':
      return Object.freeze({
        kind: result.kind,
        target: result.target,
        ...solutionSummary(result.solutions, includeExpressionIdentity),
        familyCount: result.families?.length ?? 0,
        conditionKinds: conditionKinds([
          ...result.solutions,
          ...(result.families ?? [])
        ]),
        verificationStatuses: verificationStatuses([
          ...result.solutions,
          ...(result.families ?? [])
        ]),
        reason: result.reason,
        ...scoped
      });
    case 'unsupported':
      return Object.freeze({
        kind: result.kind,
        target: result.target,
        reason: result.reason,
        ...scoped
      });
    case 'limit':
      return Object.freeze({
        kind: result.kind,
        target: result.target,
        limit: result.limit,
        ...scoped
      });
  }
}

export interface SemanticComparison {
  readonly equal: boolean;
  readonly legacy: SemanticSolveSummary;
  readonly candidate: SemanticSolveSummary;
}

export function compareSolveResults(
  legacy: SolveResult,
  candidate: SolveResult
): SemanticComparison {
  const legacySummary = summarizeSolveResult(legacy);
  const candidateSummary = summarizeSolveResult(candidate);
  return Object.freeze({
    equal: JSON.stringify(legacySummary) === JSON.stringify(candidateSummary),
    legacy: legacySummary,
    candidate: candidateSummary
  });
}
