import {readFileSync} from 'node:fs';
import type {SolveOptions} from '../../src/index.js';
import type {SemanticSolveSummary} from './semantic-result.js';

const RESULT_KINDS = Object.freeze([
  'finite',
  'parametric',
  'identity',
  'contradiction',
  'partial',
  'unsupported',
  'limit'
] as const);

type ResultKind = typeof RESULT_KINDS[number];

export interface ExactStringBaselineCase {
  readonly id: string;
  readonly equation: string;
  readonly expected: string;
}

export interface SemanticBaselineCase {
  readonly id: string;
  readonly equation: string;
  readonly target: string;
  readonly options?: SolveOptions;
  readonly expected: SemanticSolveSummary & {readonly kind: ResultKind};
}

export interface ArchitectureMigrationBaseline {
  readonly schemaVersion: 1;
  readonly sourceCommit: string;
  readonly newEquationClassesResumeAfterChapter: 14;
  readonly exactStringCases: readonly ExactStringBaselineCase[];
  readonly semanticCases: readonly SemanticBaselineCase[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a nonempty string`);
  }
  return value;
}

function caseId(value: unknown, ids: Set<string>, label: string): string {
  const id = nonemptyString(value, `${label}.id`);
  if (ids.has(id)) {
    throw new TypeError(`Duplicate migration baseline case id: ${id}`);
  }
  ids.add(id);
  return id;
}

export function parseArchitectureMigrationBaseline(
  value: unknown
): ArchitectureMigrationBaseline {
  const root = record(value, 'Migration baseline');
  if (root.schemaVersion !== 1) {
    throw new TypeError('Migration baseline schemaVersion must be 1');
  }
  const sourceCommit = nonemptyString(root.sourceCommit, 'sourceCommit');
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw new TypeError('sourceCommit must be a full Git commit SHA');
  }
  if (root.newEquationClassesResumeAfterChapter !== 14) {
    throw new TypeError('New equation classes must remain frozen through Chapter 14');
  }
  if (!Array.isArray(root.exactStringCases) || !Array.isArray(root.semanticCases)) {
    throw new TypeError('Migration baseline case collections must be arrays');
  }

  const ids = new Set<string>();
  const exactStringCases = root.exactStringCases.map((raw, index) => {
    const entry = record(raw, `exactStringCases[${index}]`);
    return Object.freeze({
      id: caseId(entry.id, ids, `exactStringCases[${index}]`),
      equation: nonemptyString(entry.equation, `exactStringCases[${index}].equation`),
      expected: nonemptyString(entry.expected, `exactStringCases[${index}].expected`)
    });
  });

  const semanticCases = root.semanticCases.map((raw, index) => {
    const entry = record(raw, `semanticCases[${index}]`);
    const target = nonemptyString(entry.target, `semanticCases[${index}].target`);
    const expected = record(entry.expected, `semanticCases[${index}].expected`);
    const kind = expected.kind;
    if (typeof kind !== 'string' || !RESULT_KINDS.includes(kind as ResultKind)) {
      throw new TypeError(`semanticCases[${index}].expected.kind is invalid`);
    }
    if (expected.target !== target) {
      throw new TypeError(`semanticCases[${index}] expected target does not match`);
    }
    if (
      entry.options !== undefined &&
      (!entry.options || typeof entry.options !== 'object' || Array.isArray(entry.options))
    ) {
      throw new TypeError(`semanticCases[${index}].options must be an object`);
    }
    return Object.freeze({
      id: caseId(entry.id, ids, `semanticCases[${index}]`),
      equation: nonemptyString(entry.equation, `semanticCases[${index}].equation`),
      target,
      ...(entry.options === undefined ? {} : {options: entry.options as SolveOptions}),
      expected: Object.freeze({...expected}) as SemanticSolveSummary & {readonly kind: ResultKind}
    });
  });

  const representedKinds = new Set(semanticCases.map((entry) => entry.expected.kind));
  if (RESULT_KINDS.some((kind) => !representedKinds.has(kind))) {
    throw new TypeError('Migration baseline must represent every SolveResult kind');
  }

  return Object.freeze({
    schemaVersion: 1,
    sourceCommit,
    newEquationClassesResumeAfterChapter: 14,
    exactStringCases: Object.freeze(exactStringCases),
    semanticCases: Object.freeze(semanticCases)
  });
}

export function readArchitectureMigrationBaseline(): ArchitectureMigrationBaseline {
  const source = readFileSync(
    new URL('../fixtures/architecture-migration-baseline.json', import.meta.url),
    'utf8'
  );
  return parseArchitectureMigrationBaseline(JSON.parse(source));
}
