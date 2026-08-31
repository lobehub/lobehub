import { useEffect } from 'react';

import { type ViewMode } from './ViewModeSwitcher';

interface UseResetMemoryListOptions<Sort extends string> {
  query: string;
  resetList: (params: { q?: string; sort?: Sort }) => void;
  sort?: Sort;
  viewMode: ViewMode;
}

/**
 * Reset pagination for every list query change. An undefined sort is the backend default, not a
 * reason to skip a search reset.
 */
export const useResetMemoryList = <Sort extends string>({
  query,
  resetList,
  sort,
  viewMode,
}: UseResetMemoryListOptions<Sort>) => {
  const activeSort = viewMode === 'grid' ? sort : undefined;

  useEffect(() => {
    resetList({ q: query || undefined, sort: activeSort });
  }, [activeSort, query, resetList]);
};
