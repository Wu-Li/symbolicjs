import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import {loadAcceptanceFixtures} from './support/acceptance.js';

const cases = loadAcceptanceFixtures(new URL('./fixtures/baseline.json', import.meta.url));

describe('permanent regression corpus', () => {
  it.each(cases)('$id', ({equation, target, expectedKind}) => {
    const math = importsymbolicjs(create(all!));
    const result = math.solveEquation(equation, target);

    expect(result.kind).toBe(expectedKind);
    if (result.kind === 'finite') {
      for (const solution of result.solutions) {
        expect(solution.verification.status).toBe('proven');
      }
    }
  });
});
