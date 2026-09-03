import {all, create, isAssignmentNode, isSymbolNode} from 'mathjs';
import type {MathNode} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {
  EQUALITY_OPERATOR,
  importsymbolicjs,
  isEqualityNode,
  splitEquation
} from '../src/index.js';

function createMath() {
  return importsymbolicjs(create(all!));
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

  it('maps both children and validates mapped values', () => {
    const math = createMath();
    const equation = math.parseEquation('x =:= y');
    const mapped = equation.map((child, path) =>
      path === 'lhs' ? new math.ParenthesisNode(child) : child
    );

    expect(mapped).not.toBe(equation);
    expect(mapped.toString()).toBe('(x) =:= y');
    expect(() => equation.map(() => null as never)).toThrow(
      'Callback function must return a Node'
    );
  });

  it('supports shallow and deep cloning without mutating its children', () => {
    const math = createMath();
    const equation = math.parseEquation('x + 1 =:= y');
    const shallow = equation.clone();
    const deep = equation.cloneDeep();

    expect(shallow).not.toBe(equation);
    expect(shallow.lhs).toBe(equation.lhs);
    expect(shallow.rhs).toBe(equation.rhs);
    expect(deep.lhs).not.toBe(equation.lhs);
    expect(deep.rhs).not.toBe(equation.rhs);
    expect(deep.equals(equation)).toBe(true);
  });

  it('formats HTML and LaTeX through its child nodes', () => {
    const math = createMath();
    const equation = math.parseEquation('x + 1 =:= y / 2');

    expect(equation.toHTML()).toContain('math-operator');
    expect(equation.toHTML()).toContain('=:=');
    expect(equation.toTex()).toContain('=');
    expect(equation.toTex()).not.toContain('=:=');
  });

  it('rejects non-node constructor arguments', () => {
    const math = createMath();

    expect(() => new math.EqualityNode(null as never, math.parse('1')))
      .toThrow('MathJS Node expected for parameter "lhs"');
    expect(() => new math.EqualityNode(math.parse('1'), {} as never))
      .toThrow('MathJS Node expected for parameter "rhs"');
  });

  it('clones and restores its own JSON representation', () => {
    const math = createMath();
    const equation = math.parseEquation('x =:= y');
    const clone = equation.cloneDeep();
    const restored = math.EqualityNode.fromJSON(equation.toJSON());

    expect(clone).not.toBe(equation);
    expect(clone.equals(equation)).toBe(true);
    expect(restored.equals(equation)).toBe(true);
    expect(JSON.parse(JSON.stringify(equation)).mathjs).toBe('EqualityNode');
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
    ['f("=:=") =:= y', {lhs: 'f("=:=")', rhs: 'y'}],
    ["f('\\\'=:=' ) =:= y", {lhs: "f('\\\'=:=' )", rhs: 'y'}],
    ['[1, 2] =:= {a: 1}', {lhs: '[1, 2]', rhs: '{a: 1}'}],
    ['(x =:= y) =:= z', {lhs: '(x =:= y)', rhs: 'z'}]
  ])('handles grouping and quotes in %s', (expression, expected) => {
    expect(splitEquation(expression)).toEqual(expected);
  });

  it.each([
    'x + y',
    'x =:= y =:= z',
    '=:= y',
    'x =:=',
    '(x + 1 =:= y'
    ,'x + 1) =:= y'
    ,'"x =:= y'
  ])('rejects malformed equation %s', (expression) => {
    expect(() => splitEquation(expression)).toThrow();
  });

  it('rejects non-string input and forbidden blocks or function assignments', () => {
    const math = createMath();

    expect(() => splitEquation(null as never)).toThrow(TypeError);
    expect(() => math.parseEquation('x = 1; x + 1 =:= y'))
      .toThrow('BlockNode is not allowed');
    expect(() => math.parseEquation('f(x) = x + 1 =:= y'))
      .toThrow('FunctionAssignmentNode is not allowed');
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
