import {all, create, isAssignmentNode, isSymbolNode} from 'mathjs';
import type {MathNode} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {
  EQUALITY_OPERATOR,
  importCasjs,
  isEqualityNode,
  splitEquation
} from '../src/index.js';

function createMath() {
  return importCasjs(create(all!));
}

function renameX(node: MathNode, math: ReturnType<typeof createMath>): MathNode {
  return node.transform<MathNode>((candidate) =>
    isSymbolNode(candidate) && candidate.name === 'x'
      ? new math.SymbolNode('z')
      : candidate
  );
}

describe('EqualityNode', () => {
  it('installs into a MathJS instance through factories', () => {
    const math = createMath();
    const equation = math.parseEquation('x + 1 =:= y / 2');

    expect(equation).toBeInstanceOf(math.EqualityNode);
    expect(isEqualityNode(equation)).toBe(true);
    expect(equation.type).toBe('EqualityNode');
    expect(equation.lhs.toString()).toBe('x + 1');
    expect(equation.rhs.toString()).toBe('y / 2');
  });

  it('uses =:= as its canonical parser and string symbol', () => {
    const math = createMath();
    const equation = math.parseEquation('x+1=:=y');

    expect(EQUALITY_OPERATOR).toBe('=:=');
    expect(equation.toString()).toBe('x + 1 =:= y');
    expect(equation.toTex()).toBe(' x+1= y');
  });

  it('compiles to MathJS equality evaluation', () => {
    const math = createMath();
    const equation = math.parseEquation('x + 1 =:= y');
    const evaluate = equation.compile().evaluate;

    expect(evaluate({x: 2, y: 3})).toBe(true);
    expect(evaluate({x: 2, y: 4})).toBe(false);
  });

  it('participates in traversal and transformation', () => {
    const math = createMath();
    const equation = math.parseEquation('x + 1 =:= y');
    const paths: string[] = [];

    equation.forEach((_child, path) => paths.push(path));
    const renamed = renameX(equation, math);

    expect(paths).toEqual(['lhs', 'rhs']);
    expect(renamed.toString()).toBe('z + 1 =:= y');
    expect(equation.toString()).toBe('x + 1 =:= y');
  });

  it('clones and restores its own JSON representation', () => {
    const math = createMath();
    const equation = math.parseEquation('x =:= y');
    const clone = equation.cloneDeep();
    const restored = math.EqualityNode.fromJSON(equation.toJSON());

    expect(clone).not.toBe(equation);
    expect(clone.equals(equation)).toBe(true);
    expect(restored.equals(equation)).toBe(true);
  });
});

describe('parseEquation', () => {
  it('finds only a top-level operator', () => {
    expect(splitEquation('f("=:=") + (x + 1) =:= y')).toEqual({
      lhs: 'f("=:=") + (x + 1)',
      rhs: 'y'
    });
  });

  it.each([
    'x + y',
    'x =:= y =:= z',
    '=:= y',
    'x =:=',
    '(x + 1 =:= y'
  ])('rejects malformed equation %s', (expression) => {
    expect(() => splitEquation(expression)).toThrow();
  });

  it('does not change ordinary MathJS assignment parsing', () => {
    const math = createMath();
    const assignment = math.parse('x = 2');

    expect(isAssignmentNode(assignment)).toBe(true);
    expect(() => math.parse('x =:= y')).toThrow();
    expect(() => math.parseEquation('x = 2 =:= y')).toThrow(
      'AssignmentNode is not allowed'
    );
  });
});
