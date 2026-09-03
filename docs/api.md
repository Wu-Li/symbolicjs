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
the real scalar domain and returns a discriminated union:

- `finite`: a complete finite set within the supported solver family.
- `identity`: every target value satisfying the returned conditions works.
- `contradiction`: no real target value satisfying the returned conditions works.
- `partial`: useful conditional candidates exist, but a parameter degeneration
  or proof obligation remains.
- `unsupported`: the input is valid but outside the implemented solver families.
- `limit`: a deterministic safety budget stopped the operation.

Every solution contains a MathJS `value`, domain `conditions`, an `exact` flag,
and a verification result. Numeric cubic roots are approximate; symbolic linear
and quadratic expressions are exact.

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
polynomial degree, rewrite steps, traversal depth, branches, candidates,
numeric iterations, and total work.

## Initial supported families

- Single-occurrence arithmetic isolation.
- Integer powers and reciprocal-integer roots in the real domain.
- Square root, exponential, logarithm, and absolute value isolation.
- Rational normalization with denominator exclusions.
- Symbolic affine and quadratic equations.
- Numeric-coefficient cubics with real roots.

Periodic trigonometric families, simultaneous systems, inequalities, symbolic
cubics, matrices, units, and general complex branch analysis are unsupported.
