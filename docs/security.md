# Security and resource limits

Math expressions should be treated as untrusted input when they come from an
external user. Parsing alone does not evaluate an expression, but compiled
candidate verification and numeric sampling can invoke functions available on
the configured MathJS instance.

Applications processing untrusted equations should:

- Configure a restricted MathJS instance rather than importing application
  functions with side effects.
- Keep the default solver limits or choose lower limits appropriate to the
  request boundary.
- Reject inputs above an application-level byte limit before parsing.
- Run bulk or adversarial workloads outside a latency-critical process.
- Treat `unsupported`, `partial`, and `limit` as normal results rather than
  retrying them without bounds.
- Never interpret numeric sampling as a general symbolic proof.

symbolicjs bounds input-node count, symbolic and numeric polynomial degree,
rewrite steps, traversal depth, branches, candidates, generated expression nodes,
parametric families, numeric iterations, function evaluations, interval
subdivisions, brackets, and total work. These controls limit symbolic expansion
and search, but are not a substitute for process-level CPU and memory isolation in
a hostile multi-tenant service. Default values and tuning guidance are documented
in [performance.md](performance.md).
