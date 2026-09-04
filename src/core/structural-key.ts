import {isParenthesisNode} from 'mathjs';
import type {MathNode} from 'mathjs';

export type ParenthesisPolicy = 'preserve' | 'transparent';

export interface StructuralKeyOptions {
  readonly parentheses?: ParenthesisPolicy;
}

const NODE_TYPE_ORDER: Readonly<Record<string, number>> = Object.freeze({
  ConstantNode: 10,
  SymbolNode: 20,
  ParenthesisNode: 30,
  OperatorNode: 40,
  FunctionNode: 50,
  RangeNode: 60,
  IndexNode: 70,
  AccessorNode: 80,
  ArrayNode: 90,
  ObjectNode: 100,
  AssignmentNode: 110,
  FunctionAssignmentNode: 120,
  ConditionalNode: 130,
  RelationalNode: 140,
  BlockNode: 150,
  EqualityNode: 160
});

function isMathNode(value: unknown): value is MathNode {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as Partial<MathNode>).isNode === true
  );
}

function encodeNumber(value: number): string {
  if (Number.isNaN(value)) {
    return 'number:NaN';
  }
  if (value === Number.POSITIVE_INFINITY) {
    return 'number:+Infinity';
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return 'number:-Infinity';
  }
  if (Object.is(value, -0)) {
    return 'number:-0';
  }
  return `number:${value.toString()}`;
}

function encodeString(value: string): string {
  return JSON.stringify(value);
}

function encodeObject(
  value: object,
  active: WeakSet<object>,
  options: Required<StructuralKeyOptions>
): string {
  if (active.has(value)) {
    throw new TypeError('Cyclic value encountered while fingerprinting a MathJS node');
  }
  active.add(value);
  try {
    if (isMathNode(value)) {
      return encodeNode(value, active, options);
    }

    const candidate = value as {toJSON?: () => unknown};
    if (typeof candidate.toJSON === 'function') {
      const json = candidate.toJSON();
      if (json !== value) {
        const constructorName = value.constructor?.name ?? 'Object';
        return `json:${encodeString(constructorName)}:${encodeValue(
          json,
          active,
          options
        )}`;
      }
    }

    const constructorName = value.constructor?.name ?? 'Object';
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) =>
        `${encodeString(key)}:${encodeValue(entry, active, options)}`
      );
    return `object:${encodeString(constructorName)}:{${entries.join(',')}}`;
  } finally {
    active.delete(value);
  }
}

function encodeValue(
  value: unknown,
  active: WeakSet<object>,
  options: Required<StructuralKeyOptions>
): string {
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'undefined':
      return 'undefined';
    case 'boolean':
      return value ? 'boolean:true' : 'boolean:false';
    case 'number':
      return encodeNumber(value);
    case 'bigint':
      return `bigint:${value.toString()}`;
    case 'string':
      return `string:${encodeString(value)}`;
    case 'symbol':
      return `symbol:${encodeString(value.description ?? '')}`;
    case 'function':
      return `function:${encodeString(value.name)}`;
    case 'object':
      if (Array.isArray(value)) {
        if (active.has(value)) {
          throw new TypeError('Cyclic array encountered while fingerprinting a MathJS node');
        }
        active.add(value);
        try {
          return `array:[${value.map((entry) =>
            encodeValue(entry, active, options)
          ).join(',')}]`;
        } finally {
          active.delete(value);
        }
      }
      return encodeObject(value, active, options);
  }
  throw new TypeError('Unsupported value encountered while fingerprinting a MathJS node');
}

function encodeNode(
  node: MathNode,
  active: WeakSet<object>,
  options: Required<StructuralKeyOptions>
): string {
  if (options.parentheses === 'transparent' && isParenthesisNode(node)) {
    return encodeValue(node.content, active, options);
  }

  const candidate = node as MathNode & {toJSON?: () => unknown};
  const json = typeof candidate.toJSON === 'function'
    ? candidate.toJSON()
    : Object.fromEntries(
      Object.entries(node as unknown as Record<string, unknown>)
        .filter(([key]) => key !== 'isNode' && !key.startsWith('_'))
    );
  return `node:${encodeString(node.type)}:${encodeValue(json, active, options)}`;
}

function normalizeOptions(
  options: StructuralKeyOptions = {}
): Required<StructuralKeyOptions> {
  const parentheses = options.parentheses ?? 'preserve';
  if (parentheses !== 'preserve' && parentheses !== 'transparent') {
    throw new TypeError('Unknown structural parenthesis policy');
  }
  return {parentheses};
}

export function structuralTypeRank(node: MathNode): number {
  if (!isMathNode(node)) {
    throw new TypeError('MathJS node expected for structural ordering');
  }
  return NODE_TYPE_ORDER[node.type] ?? 1000;
}

/** Stable, lossless structural identity for a MathJS expression tree. */
export function structuralKey(
  node: MathNode,
  options: StructuralKeyOptions = {}
): string {
  if (!isMathNode(node)) {
    throw new TypeError('MathJS node expected for structural identity');
  }
  const normalized = normalizeOptions(options);
  return encodeValue(node, new WeakSet(), normalized);
}

/**
 * Fast non-authoritative fingerprint. Callers must compare structural keys after
 * a fingerprint match when collision freedom matters.
 */
export function structuralFingerprintFromKey(key: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < key.length; index += 1) {
    const code = key.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
    second ^= second >>> 13;
  }
  const hex = (value: number) => (value >>> 0).toString(16).padStart(8, '0');
  return `s1-${hex(first)}${hex(second)}`;
}

export function structuralFingerprint(
  node: MathNode,
  options: StructuralKeyOptions = {}
): string {
  return structuralFingerprintFromKey(structuralKey(node, options));
}
