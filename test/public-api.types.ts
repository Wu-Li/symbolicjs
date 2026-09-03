import {all, create} from 'mathjs';
import {
  EQUALITY_NODE_NAME,
  EQUALITY_OPERATOR,
  allocateIntegerParameter,
  createCanonicalizeParametricFamilies,
  createInstantiateFamily,
  createMaterializeSolutions,
  createVerifyParametricFamily,
  createSearchScope,
  createEqualityNode,
  createEquationSymbols,
  createIsolateEquation,
  createPolynomialSolve,
  createParseEquation,
  createSolveEquation,
  createSolveEquationForAll,
  createSymbolicKernel,
  equationSymbols,
  importsymbolicjs,
  isEqualityNode,
  normalizeRealInterval,
  splitEquation,
  symbolicjsFactories
} from '../src/index.js';
import type {
  EqualityNode,
  EqualityNodeConstructor,
  EqualityNodeJSON,
  ParametricSolutions,
  RealInterval,
  SolveResult,
  symbolicjsInstance
} from '../src/index.js';

const math: symbolicjsInstance = importsymbolicjs(create(all!));
const equation: EqualityNode = math.parseEquation('x =:= 1');
const constructor: EqualityNodeConstructor = math.EqualityNode;
const json: EqualityNodeJSON = equation.toJSON();
const result: SolveResult = math.solveEquation(equation, 'x');
const allResults: ReadonlyMap<string, SolveResult> = math.solveEquationForAll(equation);
const verification = math.symbolicKernel.verify(equation, 'x', math.parse('1'));
const interval: RealInterval = normalizeRealInterval({lower: -1, upper: 1});
const scope = createSearchScope('real', 'complete-in-interval', interval);

function resultKind(value: SolveResult): string {
  switch (value.kind) {
    case 'finite':
    case 'parametric':
    case 'identity':
    case 'contradiction':
    case 'partial':
    case 'unsupported':
    case 'limit':
      return value.kind;
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

declare const parametric: ParametricSolutions;

void EQUALITY_NODE_NAME;
void EQUALITY_OPERATOR;
void allocateIntegerParameter([]);
void createCanonicalizeParametricFamilies;
void createInstantiateFamily;
void createMaterializeSolutions;
void createVerifyParametricFamily;
void createEqualityNode;
void createEquationSymbols;
void createIsolateEquation;
void createPolynomialSolve;
void createParseEquation;
void createSolveEquation;
void createSolveEquationForAll;
void createSymbolicKernel;
void constructor;
void isEqualityNode(json);
void equationSymbols(equation);
void result;
void allResults;
void verification;
void interval;
void scope;
void resultKind(result);
void parametric;
void math.canonicalizeParametricFamilies(parametric.families);
void math.instantiateFamily(parametric.families[0]!, {_k0: 0});
void math.materializeSolutions(parametric, {lower: -1, upper: 1});
void math.verifyParametricFamily(equation, 'x', parametric.families[0]!);
void splitEquation('x =:= 1');
void symbolicjsFactories;
