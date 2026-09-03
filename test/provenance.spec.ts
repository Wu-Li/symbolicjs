import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const root = resolve(import.meta.dirname, '..');

function filesBelow(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

describe('algorithm provenance', () => {
  it('uses immutable identifiers for linked algorithm references', () => {
    const register = readFileSync(join(root, 'docs/algorithm-sources.md'), 'utf8');
    const sourceRows = register.split('\n').filter((line) => line.startsWith('| ') &&
      !line.startsWith('|---') && !line.startsWith('| Capability'));
    expect(sourceRows.length).toBeGreaterThan(0);
    for (const row of sourceRows) {
      const links = [...row.matchAll(/\]\((https?:\/\/[^)]+)\)/g)]
        .map((match) => match[1]!);
      for (const link of links) {
        expect(link.includes('doi.org/') || /[0-9a-f]{40}/.test(link)).toBe(true);
        expect(link).not.toMatch(/\/blob\/(?:master|main)\//);
      }
    }
  });

  it('requires notices for source marked as adapted', () => {
    const adapted = filesBelow(join(root, 'src')).filter((path) =>
      readFileSync(path, 'utf8').includes('@adapted-from')
    );
    if (adapted.length === 0) {
      expect(existsSync(join(root, 'THIRD_PARTY_NOTICES.md'))).toBe(false);
      return;
    }
    expect(readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')).toMatch(
      /copyright|license/i
    );
  });
});
