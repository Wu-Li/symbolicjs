# API guide

## Installation

```ts
import {all, create} from 'mathjs';
import {importsymbolicjs} from 'symbolicjs';

const math = importsymbolicjs(create(all));
```

MathJS remains a peer dependency. The caller owns and configures the MathJS
instance; symbolicjs installs factories into that instance and returns it.

## Equations

`math.parseEquation(source)` parses exactly one top-level `=:=`. Each side is
parsed by the original MathJS parser. Assignment, function assignment, and block
nodes are rejected inside either side.

`EqualityNode` contains immutable `lhs` and `rhs` MathJS nodes and supports the
standard MathJS traversal, transformation, compilation, formatting, cloning,
and JSON methods.

## Symbols

`math.equationSymbols(equation)` returns a frozen, sorted array of free symbol
names. Function identifiers and built-in constants are excluded.

## Solving one target

```ts
const result = math.solveEquation('x*x - 5*x + 6 =:= 0', 'x');

if (result.kind === 'finite') {
  console.log(result.solutions.map(solution => solution.value.toString()));
}
```

`solveEquation` accepts an `EqualityNode` or equation string. It solves over
the real scalar domain by default and returns a discriminated union:

- `finite`: a complete finite set within the supported solver family.
- `parametric`: a complete set of infinite integer-parameter families. The result
  contract is available in 0.2 development; trig chapters begin emitting it.
- `identity`: every target value satisfying the returned conditions works.
- `contradiction`: no real target value satisfying the returned conditions works.
- `partial`: useful conditional candidates exist, but a parameter degeneration
  or proof obligation remains.
- `unsupported`: the input is valid but outside the implemented solver families.
- `limit`: a deterministic safety budget stopped the operation.

Every solution contains a MathJS `value`, domain `conditions`, an `exact` flag,
and a verification result. Numeric cubic and quartic roots are approximate;
symbolic linear, quadratic, cubic, and quartic expressions are exact. Symbolic
cubic and quartic solutions expose frozen construction certificates containing
their original coefficients, depressed-polynomial coefficients, and selected
construction branch.

The options contract accepts `domain: 'real' | 'complex'`, a finite real
`interval`, and `numericFallback`. Unsupported domain-specific behavior remains a
typed result when its implementation chapter lands. Intervals use closed endpoints
by default; endpoint inclusion may be controlled with `includeLower` and
`includeUpper`.

## Parametric families

Parametric results contain exact MathJS expressions and explicit integer
parameters. `math.instantiateFamily(family, assignments)` substitutes safe integer
assignments and returns a MathJS node. `math.canonicalizeParametricFamilies()`
alpha-normalizes and deduplicates families without capturing symbols already used
by an equation.

`math.materializeSolutions(result, interval, scope?, options?)` converts families
that are affine in one integer parameter into sorted finite solutions over a finite
real interval. It derives integer bounds analytically, respects open endpoints and
solver budgets, and returns `complete-in-interval` scope metadata. Non-affine or
multi-parameter families return a typed unsupported result.

## Solving every member symbol

`math.solveEquationForAll(equation, options)` invokes the single-target solver
independently for each discovered symbol and returns an immutable
`ReadonlyMap<string, SolveResult>` in sorted symbol order. It does not solve a
simultaneous system.

## Diagnostics and limits

```ts
const result = math.solveEquation('x*x - 1 =:= 0', 'x', {
  diagnostics: true,
  limits: {
    inputNodes: 500,
    branches: 16,
    totalWork: 2000
  }
});

console.log(result.diagnostics?.steps);
```

Diagnostics are immutable and disabled by default. Limits cover input nodes,
symbolic and numeric polynomial degree, rewrite steps, traversal depth, branches,
candidates, parametric families, symbolic expression size, function evaluations,
interval subdivisions, numeric iterations, and total work.

## Initial supported families

- Single-occurrence arithmetic isolation.
- Integer powers and reciprocal-integer roots in the real domain.
- Square root, exponential, logarithm, and absolute value isolation.
- Rational normalization with denominator exclusions.
- Symbolic affine and quadratic equations.
- Numeric-coefficient cubics with real roots.
- Conditional exact real roots for target-free symbolic-coefficient cubics,
  including repeated-root and three-real-root discriminant branches.
- Complete numeric real roots and conditional exact symbolic real roots for
  quartics, with compact biquadratic reduction before Ferrari construction.
- Verified real roots of numeric-coefficient polynomials above degree four via a
  bounded simultaneous complex-root iteration. The default numeric degree limit is
  32; callers may raise `limits.numericPolynomialDegree` and `limits.candidates`
  for tested workloads through degree 100.
- Complete real parametric families for isolated `sin`, `cos`, `tan`, `sec`,
  `csc`, and `cot` with affine inner arguments.
- Principal-range inversion of `asin`, `acos`, and `atan`.
- Conservative compound-trig reductions for Pythagorean pairs,
  `sin(u)*cos(u)`, polynomials in one trig atom, and same-argument
  `A*sin(u)+B*cos(u)=C` equations.

Mixed-frequency trigonometric identities, simultaneous systems, inequalities,
matrices, units, and general complex branch analysis are
unsupported.
