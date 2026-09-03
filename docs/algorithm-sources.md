# Algorithm sources and provenance

This register records external implementations consulted or adapted while building
SymbolicJS. Mathematical references and independently implemented algorithms may
also be recorded here when they materially inform behavior.

Baseline:

- SymbolicJS: `0.1.0` at `cfa54e196e070a80060ab0821c87a04400e3d9ba`
- MathJS: `15.2.0`
- Node.js compatibility target: `>=22`

## Source register

| Capability | Source | Revision | Intended use | Adaptation status | License action |
|---|---|---|---|---|---|
| Cubic formula | [Nerdamer `Solve.js`](https://github.com/jiggzson/nerdamer/blob/4c0ab018848b80fd7627de4eaa6be0a590019353/Solve.js) | `4c0ab018848b80fd7627de4eaa6be0a590019353` | Formula comparison | Not adapted | None unless implementation expression is translated |
| Quartic formula | [Nerdamer `Solve.js`](https://github.com/jiggzson/nerdamer/blob/4c0ab018848b80fd7627de4eaa6be0a590019353/Solve.js) | `4c0ab018848b80fd7627de4eaa6be0a590019353` | Formula comparison | Not adapted | None unless implementation expression is translated |
| Jenkins–Traub roots | [Nerdamer `Algebra.js`](https://github.com/jiggzson/nerdamer/blob/4c0ab018848b80fd7627de4eaa6be0a590019353/Algebra.js) | `4c0ab018848b80fd7627de4eaa6be0a590019353` | Candidate implementation source | Blocked pending nested provenance review | Confirm David Binner port licensing before translation |

Nerdamer is distributed under the MIT License with the notice “Copyright (c) 2015
Martin Donk.” If substantial implementation expression is adapted, the source file
must contain an `@adapted-from` header and the repository must add
`THIRD_PARTY_NOTICES.md` with the applicable copyright and permission notices.

## Rules

1. Production source must use MathJS nodes from the configured instance.
2. A mathematical formula implemented independently is documented as a reference,
   not represented as copied code.
3. Any translated implementation must change its status above before it is
   committed.
4. Nested third-party provenance must be resolved before translation.
5. Tests derived from an external result remain non-authoritative until verified by
   substitution, domain checks, and independent invariants.

