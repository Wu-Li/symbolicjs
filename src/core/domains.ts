export type SymbolicDomain = 'integer' | 'rational' | 'real' | 'complex';
export type OperationDomain = SymbolicDomain | 'unknown';

export const SYMBOLIC_DOMAINS: readonly SymbolicDomain[] = Object.freeze([
  'integer',
  'rational',
  'real',
  'complex'
]);

const DOMAIN_RANK: Readonly<Record<SymbolicDomain, number>> = Object.freeze({
  integer: 0,
  rational: 1,
  real: 2,
  complex: 3
});

export function domainImplies(
  source: SymbolicDomain,
  target: SymbolicDomain
): boolean {
  return DOMAIN_RANK[source] <= DOMAIN_RANK[target];
}

export function narrowerDomain(
  left: SymbolicDomain,
  right: SymbolicDomain
): SymbolicDomain {
  return DOMAIN_RANK[left] <= DOMAIN_RANK[right] ? left : right;
}

export function broaderDomain(
  left: SymbolicDomain,
  right: SymbolicDomain
): SymbolicDomain {
  return DOMAIN_RANK[left] >= DOMAIN_RANK[right] ? left : right;
}

export function validateDomain(value: unknown): SymbolicDomain {
  if (!SYMBOLIC_DOMAINS.includes(value as SymbolicDomain)) {
    throw new TypeError('Unknown symbolic domain');
  }
  return value as SymbolicDomain;
}

export function validateOperationDomain(value: unknown): OperationDomain {
  if (value === 'unknown') {
    return value;
  }
  return validateDomain(value);
}
