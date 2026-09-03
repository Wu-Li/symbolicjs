import {SolverContext} from './budget.js';
import type {LimitResult, SolveOptions} from './solve-types.js';

export interface NumericComplex {
  readonly re: number;
  readonly im: number;
}

export interface NumericPolynomialRoot {
  readonly value: NumericComplex;
  readonly multiplicity: number;
  readonly residual: number;
}

export interface NumericPolynomialRoots {
  readonly kind: 'roots';
  readonly roots: readonly NumericPolynomialRoot[];
}

export type NumericPolynomialResult = NumericPolynomialRoots | LimitResult;

interface MutableComplex {
  re: number;
  im: number;
}

const complex = (re: number, im = 0): MutableComplex => ({re, im});

function add(left: NumericComplex, right: NumericComplex): MutableComplex {
  return complex(left.re + right.re, left.im + right.im);
}

function subtract(left: NumericComplex, right: NumericComplex): MutableComplex {
  return complex(left.re - right.re, left.im - right.im);
}

function multiply(left: NumericComplex, right: NumericComplex): MutableComplex {
  return complex(
    left.re * right.re - left.im * right.im,
    left.re * right.im + left.im * right.re
  );
}

function divide(left: NumericComplex, right: NumericComplex): MutableComplex {
  const denominator = right.re * right.re + right.im * right.im;
  if (denominator === 0 || !Number.isFinite(denominator)) {
    return complex(Number.NaN, Number.NaN);
  }
  return complex(
    (left.re * right.re + left.im * right.im) / denominator,
    (left.im * right.re - left.re * right.im) / denominator
  );
}

function magnitude(value: NumericComplex): number {
  return Math.hypot(value.re, value.im);
}

function distance(left: NumericComplex, right: NumericComplex): number {
  return Math.hypot(left.re - right.re, left.im - right.im);
}

function evaluateWithDerivative(
  coefficients: readonly number[],
  value: NumericComplex
): {value: MutableComplex; derivative: MutableComplex; scale: number} {
  let result = complex(coefficients[0] ?? 0);
  let derivative = complex(0);
  const radius = magnitude(value);
  let scale = Math.abs(coefficients[0] ?? 0);
  for (let index = 1; index < coefficients.length; index += 1) {
    derivative = add(multiply(derivative, value), result);
    result = add(multiply(result, value), complex(coefficients[index]!));
    scale = scale * radius + Math.abs(coefficients[index]!);
  }
  return {value: result, derivative, scale: Math.max(1, scale)};
}

function backwardResidual(
  coefficients: readonly number[],
  value: NumericComplex
): number {
  const evaluated = evaluateWithDerivative(coefficients, value);
  return magnitude(evaluated.value) / evaluated.scale;
}

function trimAndNormalize(coefficients: readonly number[]): {
  coefficients: number[];
  unscaledCoefficients: number[];
  zeroMultiplicity: number;
  variableScale: number;
} {
  if (coefficients.length < 2) {
    throw new RangeError('Numeric polynomial requires at least two coefficients');
  }
  if (coefficients.some((coefficient) => !Number.isFinite(coefficient))) {
    throw new RangeError('Numeric polynomial coefficients must be finite');
  }
  let first = 0;
  while (first < coefficients.length && coefficients[first] === 0) {
    first += 1;
  }
  if (first === coefficients.length) {
    throw new RangeError('Numeric polynomial must not be identically zero');
  }
  const trimmed = coefficients.slice(first);
  let zeroMultiplicity = 0;
  while (trimmed.length > 1 && trimmed[trimmed.length - 1] === 0) {
    trimmed.pop();
    zeroMultiplicity += 1;
  }
  if (trimmed.length === 1) {
    return {
      coefficients: [1],
      unscaledCoefficients: [1],
      zeroMultiplicity,
      variableScale: 1
    };
  }
  const leading = trimmed[0]!;
  const monic = trimmed.map((coefficient) => coefficient / leading);
  const degree = monic.length - 1;
  let variableScale = 1;
  for (let index = 1; index <= degree; index += 1) {
    const coefficient = Math.abs(monic[index]!);
    if (coefficient > 0) {
      variableScale = Math.max(
        variableScale,
        Math.exp(Math.log(coefficient) / index)
      );
    }
  }
  if (!Number.isFinite(variableScale) || variableScale <= 0) {
    variableScale = 1;
  }
  const scaled = monic.map((coefficient, index) =>
    coefficient / Math.exp(index * Math.log(variableScale))
  );
  return {
    coefficients: scaled,
    unscaledCoefficients: monic,
    zeroMultiplicity,
    variableScale
  };
}

function initialGuesses(degree: number, radius: number): MutableComplex[] {
  const roots: MutableComplex[] = [];
  const phase = Math.PI / (2 * degree);
  for (let index = 0; index < degree; index += 1) {
    const angle = 2 * Math.PI * index / degree + phase;
    const shell = radius * (0.55 + 0.45 * (index + 1) / degree);
    roots.push(complex(shell * Math.cos(angle), shell * Math.sin(angle)));
  }
  return roots;
}

function symmetrize(roots: MutableComplex[], tolerance: number): void {
  const used = new Set<number>();
  const pairingTolerance = Math.max(1e-8, 100 * Math.sqrt(tolerance));
  for (let index = 0; index < roots.length; index += 1) {
    if (used.has(index)) {
      continue;
    }
    const root = roots[index]!;
    const realTolerance = Math.max(1e-9, 10 * Math.sqrt(tolerance)) *
      (1 + Math.abs(root.re));
    if (Math.abs(root.im) <= realTolerance) {
      root.im = 0;
      used.add(index);
      continue;
    }
    let match = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate < roots.length; candidate += 1) {
      if (candidate === index || used.has(candidate)) {
        continue;
      }
      const other = roots[candidate]!;
      if (Math.sign(other.im) === Math.sign(root.im)) {
        continue;
      }
      const error = Math.hypot(root.re - other.re, root.im + other.im);
      if (error < best) {
        match = candidate;
        best = error;
      }
    }
    if (match >= 0 && best <= pairingTolerance * (1 + magnitude(root))) {
      const other = roots[match]!;
      const real = (root.re + other.re) / 2;
      const imaginary = (Math.abs(root.im) + Math.abs(other.im)) / 2;
      root.re = real;
      root.im = root.im < 0 ? -imaginary : imaginary;
      other.re = real;
      other.im = -root.im;
      used.add(index);
      used.add(match);
    } else {
      used.add(index);
    }
  }
}

function clusterRoots(
  roots: readonly MutableComplex[],
  coefficients: readonly number[],
  tolerance: number
): NumericPolynomialRoot[] {
  const ordered = [...roots].sort((left, right) =>
    left.re - right.re || left.im - right.im
  );
  const clusters: MutableComplex[][] = [];
  const clusterTolerance = Math.max(1e-9, 10 * Math.sqrt(tolerance));
  for (const root of ordered) {
    const cluster = clusters.find((entries) => {
      const center = entries.reduce(
        (sum, entry) => add(sum, entry),
        complex(0)
      );
      center.re /= entries.length;
      center.im /= entries.length;
      return distance(center, root) <= clusterTolerance * (1 + magnitude(center));
    });
    if (cluster) {
      cluster.push(root);
    } else {
      clusters.push([root]);
    }
  }
  return clusters.map((entries) => {
    let center = entries.reduce(
      (sum, entry) => add(sum, entry),
      complex(0)
    );
    center.re /= entries.length;
    center.im /= entries.length;
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const evaluation = evaluateWithDerivative(coefficients, center);
      const correction = multiply(
        divide(evaluation.value, evaluation.derivative),
        complex(entries.length)
      );
      if (!Number.isFinite(correction.re) || !Number.isFinite(correction.im)) {
        break;
      }
      if (
        magnitude(correction) >
        10 * clusterTolerance * (1 + magnitude(center))
      ) {
        break;
      }
      center = subtract(center, correction);
      if (magnitude(correction) <= tolerance * (1 + magnitude(center))) {
        break;
      }
    }
    const realTolerance = clusterTolerance * (1 + Math.abs(center.re));
    if (Math.abs(center.im) <= realTolerance) {
      center.im = 0;
    }
    return Object.freeze({
      value: Object.freeze({re: center.re, im: center.im}),
      multiplicity: entries.length,
      residual: backwardResidual(coefficients, center)
    });
  }).sort((left, right) =>
    left.value.re - right.value.re || left.value.im - right.value.im
  );
}

export class NumericPolynomialEngine {
  solve(
    inputCoefficients: readonly number[],
    target: string,
    options?: SolveOptions,
    sharedContext?: SolverContext
  ): NumericPolynomialResult {
    const context = sharedContext ?? new SolverContext(target, options);
    const tolerance = options?.tolerance ?? 1e-12;
    const normalized = trimAndNormalize(inputCoefficients);
    const coefficientScale = Math.max(...inputCoefficients.map(Math.abs));
    const original = inputCoefficients.map((coefficient) =>
      coefficient / coefficientScale
    );
    const degree = normalized.coefficients.length - 1;
    const degreeLimit = context.checkNumericPolynomialDegree(
      degree + normalized.zeroMultiplicity
    );
    if (degreeLimit) {
      return degreeLimit;
    }
    const candidateLimit = context.consume(
      'candidates',
      degree + normalized.zeroMultiplicity
    );
    if (candidateLimit) {
      return candidateLimit;
    }
    const roots: MutableComplex[] = [];
    if (degree > 0) {
      const radius = 1 + Math.max(
        0,
        ...normalized.coefficients.slice(1).map(Math.abs)
      );
      let approximations = initialGuesses(degree, radius);
      let converged = false;
      while (!converged) {
        const iterationLimit = context.consume('numeric-iterations');
        if (iterationLimit) {
          return iterationLimit;
        }
        const workLimit = context.consume('total-work', degree);
        if (workLimit) {
          return workLimit;
        }
        const previous = approximations;
        const next: MutableComplex[] = [];
        let maximumCorrection = 0;
        let maximumResidual = 0;
        for (let index = 0; index < degree; index += 1) {
          const root = previous[index]!;
          const evaluation = evaluateWithDerivative(normalized.coefficients, root);
          const unscaledRoot = complex(
            root.re * normalized.variableScale,
            root.im * normalized.variableScale
          );
          const residual = backwardResidual(
            normalized.unscaledCoefficients,
            unscaledRoot
          );
          maximumResidual = Math.max(maximumResidual, residual);
          let correction = divide(evaluation.value, evaluation.derivative);
          if (!Number.isFinite(correction.re) || !Number.isFinite(correction.im)) {
            const angle = 2 * Math.PI * (index + 1) / (degree + 1);
            correction = complex(
              tolerance * Math.cos(angle),
              tolerance * Math.sin(angle)
            );
          }
          let repulsion = complex(0);
          for (let otherIndex = 0; otherIndex < degree; otherIndex += 1) {
            if (otherIndex === index) {
              continue;
            }
            const separation = subtract(root, previous[otherIndex]!);
            if (magnitude(separation) <= Number.EPSILON) {
              const angle = 2 * Math.PI * (index + 1) / (degree + 1);
              separation.re += Number.EPSILON * Math.cos(angle);
              separation.im += Number.EPSILON * Math.sin(angle);
            }
            repulsion = add(repulsion, divide(complex(1), separation));
          }
          const denominator = subtract(complex(1), multiply(correction, repulsion));
          const adjusted = divide(correction, denominator);
          const usable = Number.isFinite(adjusted.re) && Number.isFinite(adjusted.im)
            ? adjusted
            : correction;
          maximumCorrection = Math.max(maximumCorrection, magnitude(usable));
          next.push(subtract(root, usable));
        }
        approximations = next;
        converged = maximumResidual <= Math.max(
          tolerance * 100,
          Number.EPSILON * degree * 10
        ) || (
          maximumCorrection <= tolerance * 10 &&
          maximumResidual <= Math.sqrt(tolerance)
        );
      }

      for (const root of approximations) {
        let polished = root;
        for (let iteration = 0; iteration < 12; iteration += 1) {
          const evaluation = evaluateWithDerivative(normalized.coefficients, polished);
          const correction = divide(evaluation.value, evaluation.derivative);
          if (!Number.isFinite(correction.re) || !Number.isFinite(correction.im)) {
            break;
          }
          polished = subtract(polished, correction);
          if (magnitude(correction) <= tolerance * (1 + magnitude(polished))) {
            break;
          }
        }
        let unscaled = complex(
          polished.re * normalized.variableScale,
          polished.im * normalized.variableScale
        );
        for (let iteration = 0; iteration < 8; iteration += 1) {
          const evaluation = evaluateWithDerivative(
            normalized.unscaledCoefficients,
            unscaled
          );
          const correction = divide(evaluation.value, evaluation.derivative);
          if (!Number.isFinite(correction.re) || !Number.isFinite(correction.im)) {
            break;
          }
          unscaled = subtract(unscaled, correction);
          if (magnitude(correction) <= tolerance * (1 + magnitude(unscaled))) {
            break;
          }
        }
        roots.push(unscaled);
      }
    }
    for (let count = 0; count < normalized.zeroMultiplicity; count += 1) {
      roots.push(complex(0));
    }
    symmetrize(roots, tolerance);
    const clustered = clusterRoots(roots, original, tolerance);
    return Object.freeze({kind: 'roots', roots: Object.freeze(clustered)});
  }
}

export function findNumericPolynomialRoots(
  coefficients: readonly number[],
  target = 'x',
  options?: SolveOptions
): NumericPolynomialResult {
  return new NumericPolynomialEngine().solve(coefficients, target, options);
}
