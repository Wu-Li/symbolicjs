import {all, create} from 'mathjs';
import {describe, expect, it} from 'vitest';
import {importsymbolicjs, symbolicjsFactories} from '../src/index.js';

describe('README examples', () => {
  it('executes the quick-start equation and solver examples', () => {
    const math = importsymbolicjs(create(all!));
    const equation = math.parseEquation('x + 1 =:= y / 2');

    expect(equation.type).toBe('EqualityNode');
    expect(equation.lhs.toString()).toBe('x + 1');
    expect(equation.rhs.toString()).toBe('y / 2');
    expect(equation.toString()).toBe('x + 1 =:= y / 2');
    expect(equation.toTex()).toContain('=');

    const finite = math.solveEquation('x*x - 5*x + 6 =:= 0', 'x');
    const periodic = math.solveEquation('sin(x) =:= 0', 'x');
    const bounded = math.solveEquation('sin(x) =:= x/2', 'x', {
      numericFallback: true,
      interval: {lower: -2, upper: 2}
    });
    const complex = math.solveEquation('x^2 + 1 =:= 0', 'x', {
      domain: 'complex'
    });

    expect(finite.kind).toBe('finite');
    expect(periodic.kind).toBe('parametric');
    expect(bounded.kind).toBe('partial');
    expect(complex.kind).toBe('finite');
  });

  it('supports direct factory installation and documented feature detection', () => {
    const math = create(all!);
    math.import([...symbolicjsFactories]);
    const extended = math as ReturnType<typeof importsymbolicjs>;

    expect(
      typeof extended.parseEquation === 'function' &&
      typeof extended.solveEquation === 'function' &&
      typeof extended.EqualityNode === 'function'
    ).toBe(true);
    expect(extended.parseEquation('x =:= 1').isEqualityNode).toBe(true);
  });
});
