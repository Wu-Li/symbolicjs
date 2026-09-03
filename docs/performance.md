# Performance, accuracy, and solver limits

SymbolicJS uses deterministic work counters as its primary resource boundary.
Wall-clock benchmark ceilings are regression alarms, not API guarantees: runtime
depends on the configured MathJS instance, Node version, hardware, coefficients,
and requested tolerance.

## Default limits

| Option | Default | Protects |
|---|---:|---|
| `inputNodes` | 1,000 | traversal of oversized expression trees |
| `polynomialDegree` | 4 | symbolic polynomial formula growth |
| `numericPolynomialDegree` | 32 | simultaneous numeric root count |
| `rewriteSteps` | 500 | normalization and isolation rewrites |
| `recursionDepth` | 100 | recursive symbolic descent |
| `branches` | 64 | inverse, absolute-value, and formula branches |
| `candidates` | 64 | candidate verification and materialization |
| `numericIterations` | 1,000 | root refinement and simultaneous iteration |
| `functionEvaluations` | 5,000 | bounded residual evaluation |
| `intervalSubdivisions` | 2,048 | adaptive interval search |
| `brackets` | 256 | bracket refinement |
| `parametricFamilies` | 64 | family normalization/materialization |
| `symbolicExpressionNodes` | 100,000 | generated symbolic formula size |
| `totalWork` | 100,000 | cross-operation work accounting |

All overrides must be nonnegative safe integers. Raising one limit may require
raising `candidates`, `numericIterations`, or `totalWork` as well. Degree-50 and
degree-100 workloads are tested with explicit larger numeric-polynomial,
candidate, and total-work limits; they are not the default request size.

## Numeric accuracy

The default solve tolerance is `1e-12`. Numeric polynomial roots are accepted using
a scale-aware backward residual and are rechecked in the original equation.
Complex roots use Euclidean distance in the complex plane, canonical real-then-
imaginary ordering, conjugate normalization for real coefficients, and tolerance-
based zero-component normalization.

General numeric fallback compiles one residual, searches only a caller-provided
finite real interval, validates domain conditions at each sample, refines brackets,
and independently verifies candidates. Because adaptive sampling cannot generally
prove that no root was missed, its completeness is `partial` unless a future rule
adds a specific certificate.

Exact symbolic expressions still carry conditions when division, roots, logarithms,
or coefficient degenerations require them. Numeric evidence alone does not upgrade
an inconclusive symbolic proof.

## Regression benchmark

`npm run test:benchmark` measures these named workloads:

- elementary isolation/rational/polynomial corpus;
- isolated affine trigonometry;
- quartic construction;
- numeric degree 20, 50, and 100 polynomials;
- bounded mixed-transcendental search.

The checked-in ceilings are deliberately generous (5 seconds per specialized
group and 10 seconds for 50 passes over the elementary corpus) to avoid treating
ordinary CI variance as a regression. The script prints measured milliseconds so
a material trend can be reviewed before changing a ceiling.

## Operational guidance

Keep defaults for interactive or untrusted input. Apply an application-level source
length limit before parsing and isolate hostile workloads at the process boundary.
A `limit` result is a normal terminal classification; retry only with a deliberate,
bounded policy change.
