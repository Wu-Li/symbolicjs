import {readFileSync, readdirSync} from 'node:fs';
import {relative, resolve} from 'node:path';
import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import * as publicApi from '../src/index.js';
import {importsymbolicjs} from '../src/index.js';
import {dualRunOperation, dualRunSolve} from './support/dual-run.js';
import {
  parseArchitectureMigrationBaseline,
  readArchitectureMigrationBaseline
} from './support/migration-baseline.js';
import {summarizeSolveResult} from './support/semantic-result.js';

const root = resolve(import.meta.dirname, '..');
const readJson = (path: string): unknown => JSON.parse(readFileSync(resolve(root, path), 'utf8'));

interface PublicApiInventory {
  readonly schemaVersion: number;
  readonly baselineCommit: string;
  readonly valueExports: readonly string[];
  readonly typeExports: readonly string[];
}

interface ModuleMap {
  readonly schemaVersion: number;
  readonly baselineCommit: string;
  readonly modules: readonly {readonly path: string}[];
}

interface BaselineMetrics {
  readonly schemaVersion: number;
  readonly sourceCommit: string;
  readonly packageVersion: string;
  readonly package: {
    readonly packedBytes: number;
    readonly unpackedBytes: number;
    readonly fileCount: number;
  };
  readonly productionJavaScriptBytes: Readonly<Record<string, number>>;
  readonly timings: readonly {readonly label: string; readonly iterations: number}[];
  readonly expressionMetrics: readonly {
    readonly label: string;
    readonly peakNodes: number;
  }[];
}

function parseIndexExports(source: string): {
  valueExports: readonly string[];
  typeExports: readonly string[];
} {
  const valueExports: string[] = [];
  const typeExports: string[] = [];
  const pattern = /export(\s+type)?\s*\{([\s\S]*?)\}\s*from/g;
  for (const match of source.matchAll(pattern)) {
    const body = match[2];
    if (body === undefined) {
      continue;
    }
    const target = match[1] === undefined ? valueExports : typeExports;
    for (const raw of body.split(',')) {
      const item = raw.trim();
      if (item === '') {
        continue;
      }
      const exported = item.split(/\s+as\s+/).at(-1);
      if (exported !== undefined) {
        target.push(exported);
      }
    }
  }
  return {
    valueExports: Object.freeze(valueExports.sort()),
    typeExports: Object.freeze(typeExports.sort())
  };
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : path.endsWith('.ts')
        ? [relative(root, path).replaceAll('\\', '/')]
        : [];
  });
}

describe('architecture migration inventory', () => {
  it('freezes every public runtime and type export at the baseline', () => {
    const inventory = readJson(
      'docs/architecture-migration/public-api.json'
    ) as PublicApiInventory;
    const declarations = parseIndexExports(readFileSync(resolve(root, 'src/index.ts'), 'utf8'));

    expect(inventory.schemaVersion).toBe(1);
    expect(inventory.baselineCommit).toBe('f37f1636689c382cc514d29cc168d0aa010baee7');
    expect([...inventory.valueExports].sort()).toEqual(declarations.valueExports);
    expect([...inventory.typeExports].sort()).toEqual(declarations.typeExports);
    expect(Object.keys(publicApi).sort()).toEqual([...inventory.valueExports].sort());
  });

  it('maps every production TypeScript module into the migration architecture', () => {
    const map = readJson(
      'docs/architecture-migration/module-map.json'
    ) as ModuleMap;
    const mapped = map.modules.map((entry) => entry.path).sort();

    expect(map.schemaVersion).toBe(1);
    expect(map.baselineCommit).toBe('f37f1636689c382cc514d29cc168d0aa010baee7');
    expect(new Set(mapped).size).toBe(mapped.length);
    expect(mapped).toEqual(sourceFiles(resolve(root, 'src')).sort());
  });

  it('records usable package, module, timing, and expression-size measurements', () => {
    const metrics = readJson(
      'docs/architecture-migration/baseline-metrics.json'
    ) as BaselineMetrics;

    expect(metrics.schemaVersion).toBe(1);
    expect(metrics.sourceCommit).toBe('f37f1636689c382cc514d29cc168d0aa010baee7');
    expect(metrics.packageVersion).toBe('0.5.3');
    expect(metrics.package.packedBytes).toBeGreaterThan(0);
    expect(metrics.package.unpackedBytes).toBeGreaterThan(metrics.package.packedBytes);
    expect(metrics.package.fileCount).toBeGreaterThan(0);
    expect(Object.keys(metrics.productionJavaScriptBytes).length).toBeGreaterThan(0);
    expect(Object.values(metrics.productionJavaScriptBytes).every((bytes) => bytes > 0)).toBe(true);
    expect(metrics.timings.length).toBeGreaterThanOrEqual(5);
    expect(metrics.timings.every((measurement) => measurement.iterations > 0)).toBe(true);
    expect(metrics.expressionMetrics.map((measurement) => measurement.label).sort()).toEqual([
      'symbolic-biquadratic',
      'symbolic-cubic'
    ]);
    expect(metrics.expressionMetrics.every((measurement) => measurement.peakNodes >= 0)).toBe(true);
  });
});

describe('architecture migration compatibility baseline', () => {
  it('covers every result kind with stable semantic summaries', () => {
    const baseline = readArchitectureMigrationBaseline();
    const math = importsymbolicjs(create(all!));

    for (const entry of baseline.semanticCases) {
      const result = math.solveEquation(entry.equation, entry.target, entry.options);
      expect(summarizeSolveResult(result, {includeExpressionIdentity: false}), entry.id)
        .toEqual(entry.expected);
    }
  });

  it('keeps the explicitly declared equation string contract exact', () => {
    const baseline = readArchitectureMigrationBaseline();
    const math = importsymbolicjs(create(all!));

    for (const entry of baseline.exactStringCases) {
      expect(math.parseEquation(entry.equation).toString(), entry.id).toBe(entry.expected);
    }
  });

  it('provides a dual-run harness for incremental replacements', () => {
    const math = importsymbolicjs(create(all!));
    const invocation = {equation: 'x + 1 =:= 3', target: 'x'};
    const operation = (input: typeof invocation) =>
      math.solveEquation(input.equation, input.target);
    const same = dualRunSolve(invocation, operation, operation);
    const different = dualRunOperation(
      invocation,
      operation,
      () => math.solveEquation('x + 1 =:= 4', 'x'),
      summarizeSolveResult,
      summarizeSolveResult
    );

    expect(same.equal).toBe(true);
    expect(same.comparison.equal).toBe(true);
    expect(different.equal).toBe(false);
    expect(different.legacySnapshot).not.toEqual(different.candidateSnapshot);
  });

  it('rejects malformed and duplicate migration fixtures', () => {
    const baseline = readArchitectureMigrationBaseline();
    const duplicate = {
      ...baseline,
      semanticCases: [...baseline.semanticCases, baseline.semanticCases[0]!]
    };
    const unknownKind = {
      ...baseline,
      semanticCases: baseline.semanticCases.map((entry, index) => index === 0
        ? {...entry, expected: {...entry.expected, kind: 'unknown'}}
        : entry)
    };

    expect(() => parseArchitectureMigrationBaseline(null)).toThrow(TypeError);
    expect(() => parseArchitectureMigrationBaseline(duplicate)).toThrow(/Duplicate/);
    expect(() => parseArchitectureMigrationBaseline(unknownKind)).toThrow(/kind is invalid/);
  });
});
