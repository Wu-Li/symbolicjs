# Solver algorithms and guarantees

SymbolicJS composes narrow recognizers over MathJS expression trees. A recognizer
must prove that its input has the expected shape before rewriting it; otherwise it
returns a typed unsupported result and dispatch advances. Candidate values are
always checked against the original `EqualityNode` rather than only a transformed
residual.

## Dispatch and isolation

The dispatcher tries single-occurrence isolation, isolated trigonometric rules,
compound trigonometric rules, and rational-polynomial extraction in that order.
Optional bounded numeric search is last. Complex mode is deliberately narrower and
dispatches only to the polynomial engine.

Isolation reverses arithmetic one operation at a time. Each inverse operation adds
conditions before it changes the tree: denominators and symbolic coefficients are
nonzero, real even roots are nonnegative, logarithm arguments are positive, and
inverse circular values remain in principal ranges. Absolute value and reciprocal
integer powers create explicit, budgeted branches.

## Trigonometric families

Isolated `sin`, `cos`, `tan`, `sec`, `csc`, and `cot` equations produce complete
families parameterized by a hygienically allocated integer symbol. Affine inner
arguments are inverted symbolically. Equivalent families are alpha-normalized and
deduplicated before return.

Compound rules cover same-argument Pythagorean identities, sine-cosine products,
polynomials in one circular-function atom, and linear sine/cosine combinations via
an amplitude-phase construction. Mixed arguments or frequencies remain typed
unsupported outcomes unless bounded numeric fallback is explicitly requested.

## Polynomial solving

The polynomial extractor represents coefficients as a sparse target-relative map
and preserves original denominator conditions. Real affine and quadratic formulas
are exact. Cubics use depressed-cubic discriminant cases, including repeated roots,
the one-real-root branch, and a real trigonometric construction for three-real-root
cases. Quartics prefer a compact biquadratic reduction and otherwise use a Ferrari
resolvent construction. Symbolic coefficient degenerations remain conditional or
partial rather than silently assuming a nonzero leading coefficient.

Numeric real-coefficient polynomials use an independently implemented simultaneous
Aberth-style iteration. Coefficients are normalized and variable-scaled; roots are
polished, conjugate-normalized, clustered for multiplicity, and measured by a
scale-aware backward residual. Real mode filters the complete complex set to
verified real roots. Explicit complex mode returns all distinct roots with
multiplicity when degree accounting and residual checks succeed.

## Bounded numeric fallback

General real fallback requires `numericFallback: true` and a finite interval. The
engine compiles one residual, caches evaluations, adaptively subdivides curved,
near-zero, and partly invalid regions, refines sign-changing brackets with
bisection, and probes local residual minima for tangent/even-multiplicity roots.
Every evaluation and refinement consumes deterministic budgets.

Undefined samples split or terminate local search and are never accepted as
candidates. Endpoints obey their open/closed flags. Candidate conditions are tested
with a safety margin, and the original equality must pass scaled verification.
Adaptive sampling alone is not a root-count proof, so generic results remain
`partial` even when every discovered candidate is proven.

## Verification status

- `symbolic` means substitution and simplification proved the equality.
- `construction` means a narrow algebraic or periodic derivation establishes the
  candidate/family.
- `bracket` records a sign-changing interval refined to a verified root.
- `residual` records a scale-aware numeric residual.
- `sample` identifies a verified near-zero sample or local-minimum candidate.

Sampling of remaining symbolic parameters is falsification evidence only. A match
does not become a general proof; a mismatch rejects the candidate.
