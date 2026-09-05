import type {MathNode} from 'mathjs';
import {NodeBuilder} from './node-builder.js';
import {pattern} from './pattern.js';
import {rewriteRule} from './rewrite.js';
import type {RewriteRule} from './rewrite.js';

function op(nodes: NodeBuilder, symbol: string, fn: string, args: readonly MathNode[]): MathNode {
  return nodes.operator(symbol, fn, args);
}

/** Reusable syntax-safe arithmetic identities used by later strategies. */
export function createFoundationalRewriteRules(nodes: NodeBuilder): readonly RewriteRule[] {
  const zero = nodes.constant(0);
  const one = nodes.constant(1);
  return Object.freeze([
    rewriteRule({
      id: 'arithmetic.add-zero',
      description: 'Remove additive zero',
      pattern: pattern.operator('+', [pattern.capture('value'), pattern.literal(zero)]),
      replace: ({bindings}) => bindings.captures.value!,
      costDirection: 'decrease',
      provenance: {family: 'arithmetic-identity'}
    }),
    rewriteRule({
      id: 'arithmetic.multiply-one',
      description: 'Remove multiplicative one',
      pattern: pattern.operator('*', [pattern.capture('value'), pattern.literal(one)]),
      replace: ({bindings}) => bindings.captures.value!,
      costDirection: 'decrease',
      provenance: {family: 'arithmetic-identity'}
    }),
    rewriteRule({
      id: 'arithmetic.divide-one',
      description: 'Remove denominator one',
      pattern: pattern.operator('/', [pattern.capture('value'), pattern.literal(one)]),
      replace: ({bindings}) => bindings.captures.value!,
      costDirection: 'decrease',
      provenance: {family: 'denominator-normalization'}
    }),
    rewriteRule({
      id: 'arithmetic.subtract-self',
      description: 'Subtract structurally identical scalar expressions',
      pattern: pattern.operator('-', [pattern.capture('value'), pattern.same('value')]),
      replace: () => nodes.constant(0),
      costDirection: 'decrease',
      provenance: {family: 'arithmetic-identity'}
    }),
    rewriteRule({
      id: 'arithmetic.double-negative',
      description: 'Remove double unary negation',
      pattern: pattern.operator('-', [
        pattern.operator('-', [pattern.capture('value')])
      ]),
      replace: ({bindings}) => bindings.captures.value!,
      costDirection: 'decrease',
      provenance: {family: 'sign-normalization'}
    }),
    rewriteRule({
      id: 'power.exponent-one',
      description: 'Remove exponent one',
      pattern: pattern.operator('^', [pattern.capture('value'), pattern.literal(one)]),
      replace: ({bindings}) => bindings.captures.value!,
      costDirection: 'decrease',
      provenance: {family: 'power-normalization'}
    })
  ]);
}

/** Existing compound-trigonometric normalization facts expressed as typed rules. */
export function createCompoundTrigRewriteRules(nodes: NodeBuilder): readonly RewriteRule[] {
  const captureArgument = () => pattern.capture('argument');
  const negativeArgument = () => pattern.operator('-', [captureArgument()]);
  const squared = (name: string, argument = captureArgument()) => pattern.operator('^', [
    pattern.function(name, [argument]),
    pattern.literal(nodes.constant(2))
  ]);

  return Object.freeze([
    rewriteRule({
      id: 'trig.sin-odd',
      description: 'sin(-x) = -sin(x)',
      pattern: pattern.function('sin', [negativeArgument()]),
      replace: ({bindings}) => op(nodes, '-', 'unaryMinus', [nodes.call('sin', [bindings.captures.argument!])]),
      provenance: {family: 'trigonometric-parity'}
    }),
    rewriteRule({
      id: 'trig.cos-even',
      description: 'cos(-x) = cos(x)',
      pattern: pattern.function('cos', [negativeArgument()]),
      replace: ({bindings}) => nodes.call('cos', [bindings.captures.argument!]),
      costDirection: 'decrease',
      provenance: {family: 'trigonometric-parity'}
    }),
    rewriteRule({
      id: 'trig.tan-odd',
      description: 'tan(-x) = -tan(x)',
      pattern: pattern.function('tan', [negativeArgument()]),
      replace: ({bindings}) => op(nodes, '-', 'unaryMinus', [nodes.call('tan', [bindings.captures.argument!])]),
      provenance: {family: 'trigonometric-parity'}
    }),
    rewriteRule({
      id: 'trig.pythagorean',
      description: 'sin(x)^2 + cos(x)^2 = 1',
      pattern: pattern.operator('+', [
        squared('sin'),
        squared('cos', pattern.same('argument'))
      ], {commutative: true}),
      replace: () => nodes.constant(1),
      costDirection: 'decrease',
      provenance: {family: 'trigonometric-identity'}
    }),
    rewriteRule({
      id: 'trig.sin-cos-product',
      description: 'sin(x) cos(x) = sin(2x) / 2',
      pattern: pattern.operator('*', [
        pattern.function('sin', [captureArgument()]),
        pattern.function('cos', [pattern.same('argument')])
      ], {commutative: true}),
      replace: ({bindings}) => op(nodes, '*', 'multiply', [
        nodes.constant(0.5),
        nodes.call('sin', [op(nodes, '*', 'multiply', [nodes.constant(2), bindings.captures.argument!])])
      ]),
      provenance: {family: 'trigonometric-product-to-angle'}
    })
  ]);
}
