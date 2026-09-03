# symbolicjs

Computer algebra extensions for [MathJS](https://mathjs.org/), beginning with
first-class equations.

> Early development release. The package API may change before 1.0.0.

## Install

    npm install symbolicjs mathjs

## Quick start

    import {all, create} from 'mathjs';
    import {importsymbolicjs} from 'symbolicjs';

    const math = importsymbolicjs(create(all));
    const equation = math.parseEquation('x + 1 =:= y / 2');

    equation.type;           // 'EqualityNode'
    equation.lhs.toString(); // 'x + 1'
    equation.rhs.toString(); // 'y / 2'
    equation.toString();     // 'x + 1 =:= y / 2'
    equation.toTex();        // MathJS LaTeX joined by '='

    const result = math.solveEquation('x*x - 5*x + 6 =:= 0', 'x');
    // result.kind === 'finite'; roots are 2 and 3

    const periodic = math.solveEquation('sin(x) =:= 0', 'x');
    // periodic.kind === 'parametric'; one complete integer-parameter family

    const bounded = math.solveEquation('sin(x) =:= x/2', 'x', {
      numericFallback: true,
      interval: {lower: -2, upper: 2}
    });
    // bounded.kind === 'partial'; three verified roots in this interval

    const complex = math.solveEquation('x^2 + 1 =:= 0', 'x', {
      domain: 'complex'
    });
    // complex.kind === 'finite'; roots are -i and i

The lower-level factory array can be imported directly when an application
manages its own MathJS instance typing:

    import {all, create} from 'mathjs';
    import {symbolicjsFactories} from 'symbolicjs';

    const math = create(all);
    math.import([...symbolicjsFactories]);

## Equality syntax

symbolicjs uses **=:=** as its canonical equation operator. This keeps mathematical
equality distinct from MathJS assignment (**=**) and boolean comparison
(**==**).

MathJS documents extension through **math.import** and factory functions, but
it does not expose a supported API for adding an infix grammar token. For that
reason, symbolicjs imports **EqualityNode** and **parseEquation** into a MathJS
instance. **parseEquation** recognizes one top-level **=:=**, delegates each
side to that instance's original MathJS parser, and returns:

    EqualityNode {
      lhs: MathNode;
      rhs: MathNode;
    }

The package does not monkey-patch or silently replace **math.parse**. Ordinary
MathJS parsing, including assignment parsing, remains unchanged.
Assignments and function assignments are rejected inside equation sides.

## API

- **importsymbolicjs(math)** imports the symbolicjs factories and returns the same
  instance with typed **EqualityNode** and **parseEquation** members.
- **symbolicjsFactories** is the factory array for direct **math.import**.
- **EqualityNode** is a MathJS node with **lhs** and **rhs** children.
- **splitEquation(expression)** validates and splits one top-level **=:=**.
- **isEqualityNode(value)** is the runtime type guard.
- **EQUALITY_OPERATOR** is the canonical **=:=** token.
- **equationSymbols(equation)** returns sorted free member symbols.
- **solveEquation(equation, target, options?)** solves for one target.
- **solveEquationForAll(equation, options?)** independently attempts every
  member symbol and returns an immutable result map.
- **instantiateFamily**, **materializeSolutions**, and
  **verifyParametricFamily** consume parametric results without unbounded
  enumeration.
- **numericSolve** is the lower-level, explicitly bounded real search function.

**EqualityNode** supports MathJS traversal, transformation, cloning,
compilation, equality evaluation, string output, LaTeX output, HTML output, and
its own JSON codec.

See the [API guide](docs/api.md), [conformance report](docs/conformance.md),
[algorithm guide](docs/algorithms.md),
[performance and limits guide](docs/performance.md),
[testing guide](docs/testing.md), and [security guidance](docs/security.md) for
result types, supported families, limits, and integration details.

## Implemented solver scope

- First-class equality nodes, parsing, formatting, and serialization.
- Symbol discovery, immutable substitution, conservative simplification,
  domain conditions, candidate verification, and deterministic limits.
- Single-occurrence isolation for arithmetic, powers, roots, exponential,
  logarithm, and absolute value.
- Target-relative rational normalization and symbolic affine, quadratic, cubic,
  and quartic solving over the real domain.
- Complete real periodic families for isolated and selected compound
  trigonometric equations.
- Verified real roots of numeric polynomials through the configurable degree
  limit, tested through degree 100.
- Explicitly bounded adaptive numeric fallback for otherwise unsupported real
  expressions.
- Opt-in complete finite complex roots for numeric real-coefficient polynomials;
  conditional exact symbolic quadratic branches.
- Typed finite, parametric, identity, contradiction, partial, unsupported, and
  limit results with explicit conditions, verification, and completeness scope.
- Independent solve-for-all orchestration and opt-in diagnostics.

The default domain is real scalar equations. Simultaneous systems, inequalities,
matrices, units, mixed-frequency trigonometric identities, unrestricted numeric
search, complex transcendental families, and a general equivalence prover remain
unsupported. See the [0.1 migration guide](docs/migration-0.5.md) for the expanded
result union and domain options.

## Development

Requires Node 22 or newer.

    npm install
    npm run check
    npm run pack:dry

The package is tested independently of any consuming application. MathJS is a
peer dependency and is pinned to 15.2.0 in development so the node contract is
tested against a known implementation.

The stable-release requirements are tracked in the
[release checklist](docs/release-checklist.md).

## Publishing

The repository includes a tag-triggered GitHub Actions publishing workflow. A tag
must exactly match the package version, for example `v0.5.0` for package version
`0.5.0`. The workflow reruns the complete gate and asks npm to record provenance;
registry authentication is configured outside the repository.

## License

[MIT](LICENSE)
