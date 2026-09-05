import type {MathNode} from 'mathjs';
import type {OperationContextOptions} from './operation-context.js';
import type {MatchBindings, Pattern} from './pattern.js';
import type {SymbolicPredicate} from './predicate.js';
import type {NodeBuilder} from './node-builder.js';

export type RewriteCostDirection = 'decrease' | 'nonincrease' | 'any';

export interface RewriteBuildContext {
  readonly nodes: NodeBuilder;
  readonly bindings: MatchBindings;
}

export interface RewriteRule {
  readonly id: string;
  readonly description: string;
  readonly pattern: Pattern;
  readonly replace: (context: RewriteBuildContext) => MathNode;
  readonly domain?: string;
  readonly profile?: string;
  readonly costDirection: RewriteCostDirection;
  readonly provenance?: Readonly<Record<string, string>>;
}

export interface RewriteStep {
  readonly rule: string;
  readonly before: string;
  readonly after: string;
  readonly requirements: readonly SymbolicPredicate[];
}

export interface TransformResult {
  readonly node: MathNode;
  readonly changed: boolean;
  readonly requirements: readonly SymbolicPredicate[];
  readonly trace: readonly RewriteStep[];
  readonly limit?: RewriteLimit;
}

export interface RewriteLimit {
  readonly kind: 'limit';
  readonly limit:
    | 'rewriteSteps'
    | 'rewriteBranches'
    | 'rewriteStates'
    | 'rewriteFrontier'
    | 'rewriteNodeGrowth';
  readonly used: number;
  readonly maximum: number;
}

export interface RewriteOptions extends OperationContextOptions {
  readonly maximumSteps?: number;
  readonly maximumBranches?: number;
  readonly maximumStates?: number;
  readonly maximumFrontier?: number;
  readonly maximumNodeGrowth?: number;
}

export type RewriteStrategy =
  | {readonly kind: 'rule'; readonly rule: RewriteRule}
  | {readonly kind: 'top-down'; readonly strategy: RewriteStrategy}
  | {readonly kind: 'bottom-up'; readonly strategy: RewriteStrategy}
  | {readonly kind: 'choice'; readonly strategies: readonly RewriteStrategy[]}
  | {readonly kind: 'sequence'; readonly strategies: readonly RewriteStrategy[]}
  | {readonly kind: 'repeat'; readonly strategy: RewriteStrategy}
  | {readonly kind: 'best-of'; readonly strategies: readonly RewriteStrategy[]}
  | {readonly kind: 'best-first'; readonly strategies: readonly RewriteStrategy[]}
  | {readonly kind: 'branch'; readonly strategies: readonly RewriteStrategy[]};

function nonempty(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be nonempty`);
  }
  return value;
}

export function rewriteRule(rule: Omit<RewriteRule, 'costDirection'> & {
  readonly costDirection?: RewriteCostDirection;
}): RewriteRule {
  nonempty(rule.id, 'Rewrite rule id');
  nonempty(rule.description, 'Rewrite rule description');
  if (typeof rule.replace !== 'function') {
    throw new TypeError('Rewrite replacement builder must be a function');
  }
  return Object.freeze({...rule, costDirection: rule.costDirection ?? 'any'});
}

function strategies(kind: 'choice' | 'sequence' | 'best-of' | 'best-first' | 'branch', values: readonly RewriteStrategy[]): RewriteStrategy {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`${kind} strategy requires at least one child strategy`);
  }
  return Object.freeze({kind, strategies: Object.freeze([...values])}) as RewriteStrategy;
}

export const strategy = Object.freeze({
  rule(rule: RewriteRule): RewriteStrategy {
    return Object.freeze({kind: 'rule', rule});
  },
  topDown(value: RewriteStrategy): RewriteStrategy {
    return Object.freeze({kind: 'top-down', strategy: value});
  },
  bottomUp(value: RewriteStrategy): RewriteStrategy {
    return Object.freeze({kind: 'bottom-up', strategy: value});
  },
  choice(...values: readonly RewriteStrategy[]): RewriteStrategy {
    return strategies('choice', values);
  },
  sequence(...values: readonly RewriteStrategy[]): RewriteStrategy {
    return strategies('sequence', values);
  },
  repeat(value: RewriteStrategy): RewriteStrategy {
    return Object.freeze({kind: 'repeat', strategy: value});
  },
  bestOf(...values: readonly RewriteStrategy[]): RewriteStrategy {
    return strategies('best-of', values);
  },
  bestFirst(...values: readonly RewriteStrategy[]): RewriteStrategy {
    return strategies('best-first', values);
  },
  branch(...values: readonly RewriteStrategy[]): RewriteStrategy {
    return strategies('branch', values);
  }
});
