import {all, create} from 'mathjs';
import {
  EQUALITY_NODE_NAME,
  EQUALITY_OPERATOR,
  CIRCULAR_FUNCTIONS,
  CompoundTrigonometricEngine,
  NumericSolveEngine,
  allocateIntegerParameter,
  createCanonicalizeParametricFamilies,
  createInstantiateFamily,
  createMaterializeSolutions,
  createNumericSolve,
  createVerifyParametricFamily,
  createSearchScope,
  createEqualityNode,
  createEquationSymbols,
  createIsolateEquation,
  createPolynomialSolve,
  createParseEquation,
  createSolveEquation,
  createSolveEquationForAll,
  createTrigonometricSolve,
  createCompoundTrigonometricSolve,
  createSymbolicKernel,
  equationSymbols,
  importsymbolicjs,
  isEqualityNode,
  mergePartialSolveResults,
  normalizeRealInterval,
  splitEquation,
  symbolicjsFactories
} from '../src/index.js';
import type {
  EqualityNode,
  EqualityNodeConstructor,
  EqualityNodeJSON,
  CubicConstructionCertificate,
  PolynomialConstructionCertificate,
  QuarticConstructionCertificate,
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
const symbolicNode = math.symbolic.nodes.symbol('x');
const symbolicOperation = math.symbolic.operation({limits: {steps: 1}});
const symbolicLimit = symbolicOperation.consume('steps');
const symbolicPredicate = math.symbolic.predicates.positive(symbolicNode);
const symbolicJudgment = math.symbolic.ask(symbolicPredicate);
const symbolicRequirement = math.symbolic.require(symbolicPredicate, {
  mode: 'conditional'
});
const structuralAnalysis = math.symbolic.structure.analyze(symbolicNode, {
  target: 'x'
});

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
declare const cubicCertificate: CubicConstructionCertificate;
declare const quarticCertificate: QuarticConstructionCertificate;
declare const polynomialCertificate: PolynomialConstructionCertificate;

void EQUALITY_NODE_NAME;
void EQUALITY_OPERATOR;
void CIRCULAR_FUNCTIONS.sin;
void CompoundTrigonometricEngine;
void NumericSolveEngine;
void allocateIntegerParameter([]);
void createCanonicalizeParametricFamilies;
void createInstantiateFamily;
void createMaterializeSolutions;
void createNumericSolve;
void createVerifyParametricFamily;
void createEqualityNode;
void createEquationSymbols;
void createIsolateEquation;
void createPolynomialSolve;
void createParseEquation;
void createSolveEquation;
void createSolveEquationForAll;
void createTrigonometricSolve;
void createCompoundTrigonometricSolve;
void createSymbolicKernel;
void constructor;
void isEqualityNode(json);
void mergePartialSolveResults;
void equationSymbols(equation);
void result;
void allResults;
void verification;
void interval;
void scope;
void symbolicNode;
void symbolicLimit;
void symbolicJudgment;
void symbolicRequirement;
void structuralAnalysis;
void resultKind(result);
void parametric;
void cubicCertificate;
void quarticCertificate;
void polynomialCertificate;
void math.canonicalizeParametricFamilies(parametric.families);
void math.instantiateFamily(parametric.families[0]!, {_k0: 0});
void math.materializeSolutions(parametric, {lower: -1, upper: 1});
void math.verifyParametricFamily(equation, 'x', parametric.families[0]!);
void math.numericSolve(equation, 'x', {
  numericFallback: true,
  interval: {lower: -1, upper: 1}
});
void splitEquation('x =:= 1');
void symbolicjsFactories;
