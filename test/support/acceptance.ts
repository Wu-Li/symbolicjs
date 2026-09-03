import {readFileSync} from 'node:fs';
import type {MathNode} from 'mathjs';

export type AcceptanceResultKind =
  | 'finite'
  | 'parametric'
  | 'identity'
  | 'contradiction'
  | 'partial'
  | 'unsupported'
  | 'limit';

export interface AcceptanceInterval {
  readonly lower: number;
  readonly upper: number;
  readonly includeLower?: boolean;
  readonly includeUpper?: boolean;
}

export interface AcceptanceProvenance {
  readonly kind: 'regression' | 'independent' | 'differential';
  readonly source: string;
}

export interface AcceptanceFixture {
  readonly id: string;
  readonly equation: string;
  readonly target: string;
  readonly expectedKind: AcceptanceResultKind;
  readonly domain?: 'real' | 'complex';
  readonly interval?: AcceptanceInterval;
  readonly tolerance?: number;
  readonly provenance: AcceptanceProvenance;
}

export interface ComplexValue {
  readonly re: number;
  readonly im: number;
}

export type AcceptanceCompleteness =
  | 'complete'
  | 'complete-in-interval'
  | 'partial';

export interface AcceptanceSemanticAssertions {
  readonly reason?: string;
  readonly roots?: readonly (number | ComplexValue)[];
  readonly multiplicities?: readonly number[];
  readonly familyCount?: number;
  readonly conditionKinds?: readonly string[];
  readonly completeness?: AcceptanceCompleteness;
  readonly serialize?: boolean;
}

export interface ConformanceFixture extends AcceptanceFixture {
  readonly feature: string;
  readonly numericFallback?: boolean;
  readonly assertions: AcceptanceSemanticAssertions;
}

const RESULT_KINDS = new Set<AcceptanceResultKind>([
  'finite',
  'parametric',
  'identity',
  'contradiction',
  'partial',
  'unsupported',
  'limit'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  context: string
): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${context}.${key} must be a nonempty string`);
  }
  return value;
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  context: string
): boolean | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new TypeError(`${context}.${key} must be boolean`);
  }
  return value;
}

function parseInterval(value: unknown, context: string): AcceptanceInterval {
  if (!isRecord(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  const lower = value.lower;
  const upper = value.upper;
  if (
    typeof lower !== 'number' || !Number.isFinite(lower) ||
    typeof upper !== 'number' || !Number.isFinite(upper)
  ) {
    throw new RangeError(`${context} bounds must be finite numbers`);
  }
  if (lower > upper) {
    throw new RangeError(`${context}.lower must not exceed upper`);
  }
  const includeLower = optionalBoolean(value, 'includeLower', context);
  const includeUpper = optionalBoolean(value, 'includeUpper', context);
  return Object.freeze({
    lower,
    upper,
    ...(includeLower === undefined ? {} : {includeLower}),
    ...(includeUpper === undefined ? {} : {includeUpper})
  });
}

function parseFixture(value: unknown, index: number): AcceptanceFixture {
  const context = `fixtures[${index}]`;
  if (!isRecord(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  const expectedKind = value.expectedKind;
  if (typeof expectedKind !== 'string' || !RESULT_KINDS.has(
    expectedKind as AcceptanceResultKind
  )) {
    throw new TypeError(`${context}.expectedKind is unknown`);
  }
  const domain = value.domain;
  if (domain !== undefined && domain !== 'real' && domain !== 'complex') {
    throw new TypeError(`${context}.domain is unknown`);
  }
  const tolerance = value.tolerance;
  if (
    tolerance !== undefined &&
    (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance <= 0)
  ) {
    throw new RangeError(`${context}.tolerance must be positive and finite`);
  }
  if (!isRecord(value.provenance)) {
    throw new TypeError(`${context}.provenance must be an object`);
  }
  const provenanceKind = value.provenance.kind;
  if (
    provenanceKind !== 'regression' &&
    provenanceKind !== 'independent' &&
    provenanceKind !== 'differential'
  ) {
    throw new TypeError(`${context}.provenance.kind is unknown`);
  }
  const provenance = Object.freeze({
    kind: provenanceKind,
    source: requiredString(value.provenance, 'source', `${context}.provenance`)
  });
  return Object.freeze({
    id: requiredString(value, 'id', context),
    equation: requiredString(value, 'equation', context),
    target: requiredString(value, 'target', context),
    expectedKind: expectedKind as AcceptanceResultKind,
    ...(domain === undefined ? {} : {domain}),
    ...(value.interval === undefined
      ? {}
      : {interval: parseInterval(value.interval, `${context}.interval`)}),
    ...(tolerance === undefined ? {} : {tolerance}),
    provenance
  });
}

export function parseAcceptanceFixtures(value: unknown): readonly AcceptanceFixture[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Fixture document must be an array');
  }
  const fixtures = value.map(parseFixture);
  const ids = new Set<string>();
  for (const fixture of fixtures) {
    if (ids.has(fixture.id)) {
      throw new TypeError(`Duplicate fixture id: ${fixture.id}`);
    }
    ids.add(fixture.id);
  }
  return Object.freeze(fixtures);
}

export function loadAcceptanceFixtures(url: URL): readonly AcceptanceFixture[] {
  return parseAcceptanceFixtures(JSON.parse(readFileSync(url, 'utf8')) as unknown);
}

function finiteNumber(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${context} must be finite`);
  }
  return value;
}

function parseRoot(value: unknown, context: string): number | ComplexValue {
  if (typeof value === 'number') {
    return finiteNumber(value, context);
  }
  if (!isRecord(value)) {
    throw new TypeError(`${context} must be a number or complex object`);
  }
  return Object.freeze({
    re: finiteNumber(value.re, `${context}.re`),
    im: finiteNumber(value.im, `${context}.im`)
  });
}

const COMPLETENESS = new Set<AcceptanceCompleteness>([
  'complete',
  'complete-in-interval',
  'partial'
]);

function parseSemanticAssertions(
  value: unknown,
  context: string
): AcceptanceSemanticAssertions {
  if (!isRecord(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  const roots = value.roots;
  if (roots !== undefined && !Array.isArray(roots)) {
    throw new TypeError(`${context}.roots must be an array`);
  }
  const multiplicities = value.multiplicities;
  if (multiplicities !== undefined && (
    !Array.isArray(multiplicities) ||
    multiplicities.some((entry) => !Number.isSafeInteger(entry) || entry <= 0)
  )) {
    throw new RangeError(`${context}.multiplicities must contain positive integers`);
  }
  if (
    Array.isArray(roots) &&
    Array.isArray(multiplicities) &&
    roots.length !== multiplicities.length
  ) {
    throw new RangeError(`${context}.multiplicities must align with roots`);
  }
  const familyCount = value.familyCount;
  if (
    familyCount !== undefined &&
    (!Number.isSafeInteger(familyCount) || (familyCount as number) < 0)
  ) {
    throw new RangeError(`${context}.familyCount must be a nonnegative integer`);
  }
  const conditionKinds = value.conditionKinds;
  if (conditionKinds !== undefined && (
    !Array.isArray(conditionKinds) ||
    conditionKinds.some((entry) => typeof entry !== 'string' || entry.length === 0)
  )) {
    throw new TypeError(`${context}.conditionKinds must contain nonempty strings`);
  }
  const completeness = value.completeness;
  if (
    completeness !== undefined &&
    (typeof completeness !== 'string' || !COMPLETENESS.has(
      completeness as AcceptanceCompleteness
    ))
  ) {
    throw new TypeError(`${context}.completeness is unknown`);
  }
  const serialize = optionalBoolean(value, 'serialize', context);
  const reason = value.reason === undefined
    ? undefined
    : requiredString(value, 'reason', context);
  return Object.freeze({
    ...(reason === undefined ? {} : {reason}),
    ...(roots === undefined ? {} : {
      roots: Object.freeze(roots.map((entry, index) =>
        parseRoot(entry, `${context}.roots[${index}]`)
      ))
    }),
    ...(multiplicities === undefined ? {} : {
      multiplicities: Object.freeze([...(multiplicities as number[])])
    }),
    ...(familyCount === undefined ? {} : {familyCount: familyCount as number}),
    ...(conditionKinds === undefined ? {} : {
      conditionKinds: Object.freeze([...(conditionKinds as string[])])
    }),
    ...(completeness === undefined
      ? {}
      : {completeness: completeness as AcceptanceCompleteness}),
    ...(serialize === undefined ? {} : {serialize})
  });
}

export function parseConformanceFixtures(value: unknown): readonly ConformanceFixture[] {
  const fixtures = parseAcceptanceFixtures(value);
  return Object.freeze(fixtures.map((fixture, index) => {
    const source = (value as readonly unknown[])[index] as Record<string, unknown>;
    const numericFallback = optionalBoolean(source, 'numericFallback', `fixtures[${index}]`);
    return Object.freeze({
      ...fixture,
      feature: requiredString(source, 'feature', `fixtures[${index}]`),
      ...(numericFallback === undefined ? {} : {numericFallback}),
      assertions: parseSemanticAssertions(
        source.assertions,
        `fixtures[${index}].assertions`
      )
    });
  }));
}

export function loadConformanceFixtures(url: URL): readonly ConformanceFixture[] {
  return parseConformanceFixtures(JSON.parse(readFileSync(url, 'utf8')) as unknown);
}

function asComplex(value: number | ComplexValue): ComplexValue {
  return typeof value === 'number' ? {re: value, im: 0} : value;
}

export function complexDistance(
  left: number | ComplexValue,
  right: number | ComplexValue
): number {
  const a = asComplex(left);
  const b = asComplex(right);
  return Math.hypot(a.re - b.re, a.im - b.im);
}

export function rootSetsMatch(
  actual: readonly (number | ComplexValue)[],
  expected: readonly (number | ComplexValue)[],
  tolerance: number,
  preserveMultiplicity = true
): boolean {
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new RangeError('Root-set tolerance must be positive and finite');
  }
  const dedupe = (values: readonly (number | ComplexValue)[]) => {
    const unique: (number | ComplexValue)[] = [];
    for (const value of values) {
      if (!unique.some((candidate) => complexDistance(candidate, value) <= tolerance)) {
        unique.push(value);
      }
    }
    return unique;
  };
  const remaining = [...(preserveMultiplicity ? expected : dedupe(expected))];
  const candidates = preserveMultiplicity ? actual : dedupe(actual);
  if (candidates.length !== remaining.length) {
    return false;
  }
  for (const candidate of candidates) {
    const index = remaining.findIndex((expectedRoot) =>
      complexDistance(candidate, expectedRoot) <= tolerance * Math.max(
        1,
        complexDistance(candidate, 0),
        complexDistance(expectedRoot, 0)
      )
    );
    if (index < 0) {
      return false;
    }
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}

export function scaledPolynomialResidual(
  descendingCoefficients: readonly number[],
  value: number
): number {
  if (
    descendingCoefficients.length === 0 ||
    descendingCoefficients.some((coefficient) => !Number.isFinite(coefficient)) ||
    !Number.isFinite(value)
  ) {
    return Number.POSITIVE_INFINITY;
  }
  let residual = 0;
  let scale = 0;
  for (const coefficient of descendingCoefficients) {
    residual = residual * value + coefficient;
    scale = scale * Math.abs(value) + Math.abs(coefficient);
  }
  return Math.abs(residual) / Math.max(1, scale);
}

export function seededIntegers(seed: number, count: number): readonly number[] {
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(count) || count < 0) {
    throw new RangeError('Seed and count must be safe integers; count must be nonnegative');
  }
  let state = seed | 0;
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    values.push(state | 0);
  }
  return Object.freeze(values);
}

export function instantiateIntegerExpression(
  expression: MathNode,
  parameterNames: readonly string[],
  assignments: Readonly<Record<string, number>>
): unknown {
  const expected = [...new Set(parameterNames)].sort();
  const actual = Object.keys(assignments).sort();
  if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) {
    throw new TypeError('Integer parameter assignments do not match the expression');
  }
  for (const name of expected) {
    if (!Number.isSafeInteger(assignments[name])) {
      throw new TypeError(`Parameter ${name} must be a safe integer`);
    }
  }
  return expression.compile().evaluate(assignments);
}
