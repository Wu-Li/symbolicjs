# Algorithm sources and provenance

This register records mathematical references and any external implementation
expression adapted while building SymbolicJS.

Baseline:

- SymbolicJS: `0.1.0` at `cfa54e196e070a80060ab0821c87a04400e3d9ba`
- MathJS: `15.2.0`
- Node.js compatibility target: `>=22`

## Source register

| Capability | Reference | Use | Implementation status | License action |
|---|---|---|---|---|
| Cubic roots | Classical depressed-cubic/Cardano and trigonometric identities | Mathematical derivation | Independently implemented with MathJS nodes | None |
| Quartic roots | Classical biquadratic and Ferrari constructions | Mathematical derivation | Independently implemented with MathJS nodes | None |
| Simultaneous polynomial roots | Oliver Aberth, “Iteration methods for finding all zeros of a polynomial simultaneously,” *Mathematics of Computation* 27 (1973), 339–344, [doi:10.1090/S0025-5718-1973-0329236-7](https://doi.org/10.1090/S0025-5718-1973-0329236-7) | Algorithm description | Independently implemented; no implementation source copied or translated | None |
| Bounded real roots | Bisection and local residual minimization | Standard numerical methods | Independently implemented with explicit budgets | None |

No third-party implementation expression is currently copied or translated, so a
`THIRD_PARTY_NOTICES.md` file is not required for the current source tree.

## Rules

1. Production source must use MathJS nodes from the configured instance.
2. A mathematical formula implemented independently is documented as a reference,
   not represented as copied code.
3. Any translated implementation must change its status above before it is
   committed.
4. Nested third-party provenance must be resolved before translation.
5. Tests derived from an external result remain non-authoritative until verified by
   substitution, domain checks, and independent invariants.
