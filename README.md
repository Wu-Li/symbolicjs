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

**EqualityNode** supports MathJS traversal, transformation, cloning,
compilation, equality evaluation, string output, LaTeX output, HTML output, and
its own JSON codec.

See the [API guide](docs/api.md), [implementation plan](docs/implementation-plan.md),
and [security guidance](docs/security.md) for result types, supported families,
limits, and integration details.

## Implemented solver scope

- First-class equality nodes, parsing, formatting, and serialization.
- Symbol discovery, immutable substitution, conservative simplification,
  domain conditions, candidate verification, and deterministic limits.
- Single-occurrence isolation for arithmetic, powers, roots, exponential,
  logarithm, and absolute value.
- Target-relative rational normalization and symbolic affine/quadratic solving.
- Numeric cubic fallback when every coefficient is numeric.
- Typed finite, identity, contradiction, partial, unsupported, and limit results.
- Independent solve-for-all orchestration and opt-in diagnostics.

The solver domain is real scalar equations. Periodic
trigonometric families, simultaneous systems, matrices, units, and a general
equivalence prover are not part of the first solver release.

## Development

Requires Node 22 or newer.

    npm install
    npm run check
    npm run test:benchmark
    npm run pack:dry

The package is tested independently of any consuming application. MathJS is a
peer dependency and is pinned to 15.2.0 in development so the node contract is
tested against a known implementation.

The stable-release requirements are tracked in the
[release checklist](docs/release-checklist.md).

## Publishing

The repository includes a tag-triggered GitHub Actions publishing workflow.
After the package has been created on npm, configure npm trusted publishing for:

- GitHub owner: **Wu-Li**
- Repository: **symbolicjs**
- Workflow: **publish.yml**
- Allowed action: **npm publish**

Then create a version tag such as **v0.0.2**. npm trusted publishing requires no
long-lived publish token and automatically records provenance for a public
repository and package.

## License

[MIT](LICENSE)
