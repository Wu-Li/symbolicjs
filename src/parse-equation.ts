import {factory} from 'mathjs';
import type {MathNode} from 'mathjs';
import {EQUALITY_OPERATOR} from './constants.js';
import type {
  EqualityNode,
  ParseEquationDependencies
} from './types.js';

type CustomFactory = (
  name: string,
  dependencies: string[],
  create: (dependencies: Record<string, unknown>) => unknown,
  meta?: Record<string, unknown>
) => ReturnType<typeof factory>;

const customFactory = factory as unknown as CustomFactory;

interface SplitEquation {
  lhs: string;
  rhs: string;
}

const OPEN_TO_CLOSE: Readonly<Record<string, string>> = {
  '(': ')',
  '[': ']',
  '{': '}'
};

const CLOSING = new Set(Object.values(OPEN_TO_CLOSE));
const FORBIDDEN_SIDE_NODES = new Set([
  'AssignmentNode',
  'BlockNode',
  'FunctionAssignmentNode'
]);

function validateSide(node: MathNode): MathNode {
  node.traverse((candidate) => {
    if (FORBIDDEN_SIDE_NODES.has(candidate.type)) {
      throw new SyntaxError(
        candidate.type + ' is not allowed inside an equation side'
      );
    }
  });
  return node;
}

export function splitEquation(expression: string): SplitEquation {
  if (typeof expression !== 'string') {
    throw new TypeError('Equation expression must be a string');
  }

  const stack: string[] = [];
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let operatorIndex = -1;

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index]!;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    const expectedClose = OPEN_TO_CLOSE[char];
    if (expectedClose) {
      stack.push(expectedClose);
      continue;
    }

    if (CLOSING.has(char)) {
      const expected = stack.pop();
      if (expected !== char) {
        throw new SyntaxError('Unbalanced grouping in equation');
      }
      continue;
    }

    if (
      stack.length === 0 &&
      expression.startsWith(EQUALITY_OPERATOR, index)
    ) {
      if (operatorIndex >= 0) {
        throw new SyntaxError(
          'Equation must contain exactly one top-level ' + EQUALITY_OPERATOR
        );
      }
      operatorIndex = index;
      index += EQUALITY_OPERATOR.length - 1;
    }
  }

  if (quote || stack.length > 0) {
    throw new SyntaxError('Unbalanced grouping or quote in equation');
  }

  if (operatorIndex < 0) {
    throw new SyntaxError(
      'Equation must contain exactly one top-level ' + EQUALITY_OPERATOR
    );
  }

  const lhs = expression.slice(0, operatorIndex).trim();
  const rhs = expression
    .slice(operatorIndex + EQUALITY_OPERATOR.length)
    .trim();

  if (!lhs || !rhs) {
    throw new SyntaxError('Equation requires both lhs and rhs expressions');
  }

  return {lhs, rhs};
}

export const createParseEquation = customFactory(
  'parseEquation',
  ['EqualityNode', 'parse'],
  (dependencies) => {
    const {EqualityNode, parse} = dependencies as unknown as ParseEquationDependencies;
    return (
    (expression: string): EqualityNode => {
      const {lhs, rhs} = splitEquation(expression);
      return new EqualityNode(
        validateSide(parse(lhs)),
        validateSide(parse(rhs))
      );
    }
    );
  }
);
