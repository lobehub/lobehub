export type AcceptanceListFilter = 'active' | 'all' | 'completed';

export const DEFAULT_ACCEPTANCE_LIST_FILTER: AcceptanceListFilter = 'active';

export const normalizeAcceptanceListFilter = (value: unknown): AcceptanceListFilter =>
  value === 'all' || value === 'completed' ? value : DEFAULT_ACCEPTANCE_LIST_FILTER;
