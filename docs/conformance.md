# Public solver conformance

The permanent conformance corpus is implementation-neutral: entries are grouped by
mathematical feature and assert public result semantics rather than private class or
method names. The authoritative data is
`test/fixtures/conformance.json`; `test/conformance.spec.ts` parses and executes every
entry against a configured MathJS instance.

## Covered equation classes

| Mathematical feature | Representative input | Expected public behavior |
|---|---|---|
| Single-occurrence isolation | `2*x + 1 =:= 7` | complete finite real root |
| Rational definedness | `x/x =:= 1` | identity with `x != 0` condition |
| Exact exponential isolation | `exp(x) =:= 3` | exact finite logarithmic value |
| Periodic trigonometry | `sin(x) =:= 1/2` | complete parametric families |
| Compound trigonometry | `2*sin(x)+2*cos(x) =:= 1` | complete amplitude-phase families |
| Polynomial in a trig atom | `2*sin(x)^2-3*sin(x)+1 =:= 0` | deduplicated complete families |
| Cubic construction | `x^3-3*x+1 =:= 0` | three verified real roots |
| Quartic construction | `x^4-5*x^2+4 =:= 0` | four verified real roots |
| Higher-degree polynomial | `x^5-x =:= 0` | verified real roots with multiplicity |
| Bounded numeric fallback | `sin(x) =:= x/2` | verified partial roots in the interval |
| Discontinuity handling | `tan(x)+x =:= 0` | verified roots and no pole candidates |
| Complex polynomial | `x^2+1 =:= 0` | complete finite roots `-i, i` |
| Complex roots of unity | `x^5-1 =:= 0` | degree-many roots with multiplicity |
| Symbolic complex quadratic | `a*x^2+1 =:= 0` | conditional exact branches |
| Unsupported mixed frequency | `sin(x)+cos(2*x) =:= 0` | `unsupported-trig-form` |
| Unsupported complex family | complex `sin(x) =:= 0` | `unsupported-domain` |
| Missing numeric interval | fallback for `sin(x)+x =:= 0` | `interval-required` |
| Unicode identifier | `theta_θ + 1 =:= 2` | ordinary finite solution |
| Configured MathJS namespace | custom constant and function | names are not free variables |
| Equality persistence | serialized `x^2-1 =:= 0` | equivalent result after revival |

Every entry also checks input immutability, frozen result collections, deterministic
diagnostics, declared conditions, root/family counts, requested completeness, and
explicit reasons for intentionally unsupported behavior. Selected cases round-trip
through `JSON.stringify` and the configured MathJS `reviver` before solving again.

## Stable dispatch diagnostics

The public dispatcher emits stable rule identifiers in precedence order:

1. `single-occurrence-isolation`
2. `trigonometric`
3. `compound-trigonometric`
4. `rational-polynomial`, `numeric-cubic`, `numeric-quartic`, or
   `numeric-polynomial`
5. `bounded-numeric-search` when explicitly enabled and still needed

Complex mode uses `complex-polynomial`. When multiple incomplete symbolic paths
contribute useful candidates, `merge-partial-results` records the merge. Candidate
verification and final classification use `candidate-verification` and
`classification`.

This ordering ensures that an exact or complete parametric result is never replaced
by optional numeric fallback. Generic bounded search remains the final, explicitly
enabled path.
