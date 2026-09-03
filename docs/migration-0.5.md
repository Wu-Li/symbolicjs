# Migrating to the 0.5 solver contract

## From SymbolicJS 0.1

Equation parsing and `EqualityNode` remain compatible: the canonical operator is
still `=:=`, each side remains an ordinary MathJS tree, and `math.parse` is not
replaced. The main migration is that `solveEquation` now returns a richer exhaustive
union.

Handle every `result.kind`:

- `finite` contains a complete finite set for the supported scope;
- `parametric` contains complete integer-parameter families;
- `identity` and `contradiction` carry mathematical classifications and conditions;
- `partial` carries useful but incomplete `solutions`, optional `families`, and a
  retained equation `remainder`;
- `unsupported` names a stable missing-capability reason;
- `limit` names the work budget that stopped the operation.

Do not treat `partial`, `unsupported`, and `limit` as an empty finite answer. Check
`solution.exact`, `solution.verification`, and optional `result.scope` before
presenting or persisting a result. Exhaustive TypeScript switches should include the
new `parametric` branch.

The default domain remains real and general numeric search remains disabled. Enable
bounded fallback with both `numericFallback: true` and a finite `interval`. Request
finite complex polynomial roots with `domain: 'complex'`; complex transcendental
families and complex intervals are intentionally unsupported.

## From a string-oriented algebra package

Keep values as MathJS nodes rather than converting solver output to strings and
parsing it again. Construct equations with `math.parseEquation()` or
`new math.EqualityNode(lhs, rhs)`, then inspect the discriminated result.

Important semantic differences to account for:

- equality uses `=:=`, leaving MathJS assignment and comparison syntax untouched;
- equations retain separate `lhs` and `rhs` trees;
- conditions such as nonzero denominators are explicit data;
- periodic answers are parametric families rather than a finite list of principal
  values;
- approximate answers identify their verification evidence and completeness scope;
- solving for every member variable is independent orchestration, not simultaneous
  system solving;
- unsupported structures and exhausted budgets are typed outcomes, not exceptions
  or fabricated empty root sets.

Persist equations through their MathJS JSON representation and revive them with the
same configured MathJS instance (`JSON.parse(json, math.reviver)`). Custom constants
and functions should be installed on that instance before equations are solved.
