import type {MathNode} from 'mathjs';
import type {AlgebraGenerator} from '../algebra/types.js';
import type {SymbolicPredicate} from './predicate.js';

export type Pattern =
  | LiteralPattern
  | CapturePattern
  | SameCapturePattern
  | OperatorPattern
  | FunctionPattern
  | AlternativePattern
  | OptionalPattern
  | RestPattern;

export interface LiteralPattern {
  readonly kind: 'literal';
  readonly node: MathNode;
}

export type PatternGuard =
  | {readonly kind: 'predicate'; readonly predicate: SymbolicPredicate}
  | {readonly kind: 'free-of'; readonly symbols: readonly string[]}
  | {readonly kind: 'depends-on'; readonly symbols: readonly string[]}
  | {readonly kind: 'affine-in'; readonly generator: AlgebraGenerator}
  | {readonly kind: 'polynomial-in'; readonly generators: readonly AlgebraGenerator[]}
  | {readonly kind: 'rational-in'; readonly generators: readonly AlgebraGenerator[]};

export interface CapturePattern {
  readonly kind: 'capture';
  readonly name: string;
  readonly guard?: PatternGuard;
}

export interface SameCapturePattern {
  readonly kind: 'same';
  readonly name: string;
}

export interface OperatorPattern {
  readonly kind: 'operator';
  readonly op: string;
  readonly args: readonly Pattern[];
  readonly associative?: boolean;
  readonly commutative?: boolean;
}

export interface FunctionPattern {
  readonly kind: 'function';
  readonly name: string;
  readonly args: readonly Pattern[];
}

export interface AlternativePattern {
  readonly kind: 'alternative';
  readonly patterns: readonly Pattern[];
}

export interface OptionalPattern {
  readonly kind: 'optional';
  readonly pattern: Pattern;
}

export interface RestPattern {
  readonly kind: 'rest';
  readonly name: string;
}

export interface MatchBindings {
  readonly captures: Readonly<Record<string, MathNode>>;
  readonly rest: Readonly<Record<string, readonly MathNode[]>>;
}

export interface MatchResult {
  readonly bindings: MatchBindings;
  readonly requirements: readonly SymbolicPredicate[];
}

export const pattern = Object.freeze({
  literal(node: MathNode): LiteralPattern {
    return Object.freeze({kind: 'literal', node});
  },
  capture(name: string, guard?: PatternGuard): CapturePattern {
    if (!name.trim()) throw new TypeError('Capture name must be nonempty');
    return Object.freeze({kind: 'capture', name, ...(guard ? {guard} : {})});
  },
  same(name: string): SameCapturePattern {
    if (!name.trim()) throw new TypeError('Capture name must be nonempty');
    return Object.freeze({kind: 'same', name});
  },
  operator(op: string, args: readonly Pattern[], options: {associative?: boolean; commutative?: boolean} = {}): OperatorPattern {
    return Object.freeze({kind: 'operator', op, args: Object.freeze([...args]), ...options});
  },
  function(name: string, args: readonly Pattern[]): FunctionPattern {
    return Object.freeze({kind: 'function', name, args: Object.freeze([...args])});
  },
  alternative(...patterns: readonly Pattern[]): AlternativePattern {
    return Object.freeze({kind: 'alternative', patterns: Object.freeze([...patterns])});
  },
  optional(value: Pattern): OptionalPattern {
    return Object.freeze({kind: 'optional', pattern: value});
  },
  rest(name: string): RestPattern {
    if (!name.trim()) throw new TypeError('Rest capture name must be nonempty');
    return Object.freeze({kind: 'rest', name});
  }
});
