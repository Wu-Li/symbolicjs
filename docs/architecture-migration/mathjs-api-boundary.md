# Supported MathJS integration boundary

Chapter 1 introduces one narrow adapter around the configured MathJS instance. New
symbolic code should depend on that adapter or on a higher-level SymbolicJS service,
not reach into arbitrary MathJS internals.

## Factory dependencies

The experimental `math.symbolic` service requests exactly these instance-local
MathJS factory dependencies:

```text
ConstantNode
EqualityNode
FunctionNode
OperatorNode
SymbolNode
mathWithTransform
parse
reviver
```

`EqualityNode` is the SymbolicJS custom node installed on the same MathJS instance.
`mathWithTransform` is retained by reference so constants and functions imported on
that instance remain visible without copying a global namespace.

The dependency list is exported internally as
`SYMBOLIC_MATHJS_DEPENDENCIES` and asserted by focused tests. Adding another direct
MathJS dependency requires updating this document and the boundary test.

## Supported node operations

SymbolicJS may use these public `MathNode` capabilities:

- `traverse`, `forEach`, `map`, and `transform`;
- `clone` and `equals`;
- `compile` and evaluation of the compiled expression;
- `toString`, `toTex`, `toHTML`, and JSON serialization;
- type-specific public fields exposed by MathJS node interfaces.

Nodes are created only with constructors supplied by the consumer's configured
MathJS instance. SymbolicJS does not attach metadata to caller-owned nodes and does
not mutate input trees.

## Instance extension APIs

The package continues to use MathJS `factory()` definitions and `math.import()` for
installation. `parse` and `reviver` remain owned by the configured instance, so
custom numeric configuration, imported functions, custom constants, and node
revival stay instance-local.

## Isolated private-hook exception

`src/equality-node.ts` implements a genuine custom MathJS node. Its compile and map
implementation necessarily calls the protected runtime hooks `_compile` and
`_ifNode`, which MathJS does not expose in the public TypeScript node interfaces.
Those assertions must remain confined to that file. The generalized symbolic core
must not add further private MathJS hook dependencies without an explicit design
review and compatibility test.
