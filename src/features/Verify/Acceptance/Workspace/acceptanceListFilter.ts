import type { AcceptanceStatus } from '@lobechat/types';

import type { AcceptanceListItem } from '@/services/verify';

export type AcceptanceListFilter = 'active' | 'all' | 'completed';

export const DEFAULT_ACCEPTANCE_LIST_FILTER: AcceptanceListFilter = 'active';

export const normalizeAcceptanceListFilter = (value: unknown): AcceptanceListFilter =>
  value === 'all' || value === 'completed' ? value : DEFAULT_ACCEPTANCE_LIST_FILTER;

export const filterAcceptanceList = (
  items: AcceptanceListItem[],
  filter: AcceptanceListFilter,
  query: string,
) => {
  const normalizedQuery = query.trim().toLowerCase();

  return items.filter((item) => {
    const completed = (item.status as AcceptanceStatus) === 'accepted';
    if (filter === 'active' && completed) return false;
    if (filter === 'completed' && !completed) return false;

    return (
      !normalizedQuery ||
      (item.subject.title || item.subjectId).toLowerCase().includes(normalizedQuery)
    );
  });
};
