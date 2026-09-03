import {all, create} from 'mathjs';
import fc from 'fast-check';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs} from '../src/index.js';
import type {FiniteSolutions, PartialResult, SolveResult} from '../src/index.js';

function createMath() {
  return importsymbolicjs(create(all!));
}

function solutions(result: SolveResult): FiniteSolutions | PartialResult {
  expect(['finite', 'partial']).toContain(result.kind);
  return result as FiniteSolutions | PartialResult;
}

function numericValues(result: SolveResult): number[] {
  return solutions(result).solutions.map((solution) =>
    Number(solution.value.compile().evaluate())
  ).sort((left, right) => left - right);
}

const options = {seed: 20260903, numRuns: 100};

describe('generated known-solution properties', () => {
  it('solves generated affine equations', () => {
    const math = createMath();

    fc.assert(fc.property(
      fc.integer({min: -20, max: 20}).filter((value) => value !== 0),
      fc.integer({min: -50, max: 50}),
      fc.integer({min: -50, max: 50}),
      (a, b, c) => {
        const result = math.solveEquation(`${a}*x + ${b} =:= ${c}`, 'x');
        expect(numericValues(result)[0]).toBeCloseTo((c - b) / a, 10);
      }
    ), options);
  });

  it('solves generated quadratics from known real roots', () => {
    const math = createMath();

    fc.assert(fc.property(
      fc.integer({min: -10, max: 10}),
      fc.integer({min: -10, max: 10}),
      (first, second) => {
        const result = math.solveEquation(
          `(x - (${first}))*(x - (${second})) =:= 0`,
          'x'
        );
        expect(numericValues(result)).toEqual([...new Set([first, second])].sort(
          (left, right) => left - right
        ));
      }
    ), options);
  });

  it('solves generated cubics from known real roots', () => {
    const math = createMath();

    fc.assert(fc.property(
      fc.integer({min: -6, max: 6}),
      fc.integer({min: -6, max: 6}),
      fc.integer({min: -6, max: 6}),
      (first, second, third) => {
        const result = math.solveEquation(
          `(x - (${first}))*(x - (${second}))*(x - (${third})) =:= 0`,
          'x'
        );
        const expected = [...new Set([first, second, third])].sort(
          (left, right) => left - right
        );
        const actual = numericValues(result);
        expect(actual).toHaveLength(expected.length);
        expected.forEach((root, index) => {
          expect(actual[index]).toBeCloseTo(root, 8);
        });
      }
    ), {...options, numRuns: 75});
  });

  it('solves generated rational roots distinct from their pole', () => {
    const math = createMath();

    fc.assert(fc.property(
      fc.integer({min: -20, max: 20}),
      fc.integer({min: -20, max: 20}),
      (root, pole) => {
        fc.pre(root !== pole);
        const result = math.solveEquation(
          `(x - (${root}))/(x - (${pole})) =:= 0`,
          'x'
        );
        expect(numericValues(result)).toEqual([root]);
      }
    ), options);
  });

  it('solves generated absolute-value equations', () => {
    const math = createMath();

    fc.assert(fc.property(
      fc.integer({min: -20, max: 20}),
      fc.integer({min: 0, max: 20}),
      (center, distance) => {
        const result = math.solveEquation(
          `abs(x - (${center})) =:= ${distance}`,
          'x'
        );
        expect(numericValues(result)).toEqual([
          ...new Set([center - distance, center + distance])
        ].sort((left, right) => left - right));
      }
    ), options);
  });
});

describe('bounded parser and solver fuzzing', () => {
  it('never hangs or leaks unexpected errors for arbitrary parser text', () => {
    const math = createMath();
    fc.assert(fc.property(fc.string({maxLength: 120}), (source) => {
      try {
        math.parseEquation(source);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    }), {...options, numRuns: 250});
  });

  it('classifies generated valid bounded expressions', () => {
    const math = createMath();
    const atom = fc.oneof(
      fc.integer({min: -9, max: 9}).map(String),
      fc.constantFrom('x', 'y')
    );
    const source = fc.tuple(
      atom,
      fc.array(fc.tuple(fc.constantFrom('+', '-', '*'), atom), {maxLength: 6}),
      fc.integer({min: -20, max: 20})
    ).map(([first, rest, rhs]) =>
      first + rest.map(([operator, value]) => ` ${operator} ${value}`).join('') +
      ` =:= ${rhs}`
    );

    fc.assert(fc.property(source, (equation) => {
      const parsed = math.parseEquation(equation);
      const symbols = math.equationSymbols(parsed);
      for (const target of symbols) {
        const result = math.solveEquation(parsed, target, {
          limits: {inputNodes: 100, totalWork: 200}
        });
        expect([
          'finite',
          'identity',
          'contradiction',
          'partial',
          'unsupported',
          'limit'
        ]).toContain(result.kind);
      }
    }), options);
  });
});
