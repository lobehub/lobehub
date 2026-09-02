import { useLayoutEffect } from 'react';

export type ViewMode = 'grid' | 'timeline';

interface UseResetMemoryListOptions<Sort extends string> {
  query: string;
  resetList: (params: { q?: string; sort?: Sort }) => void;
  sort?: Sort;
  viewMode: ViewMode;
}

/**
 * Reset pagination before passive SWR hydration effects run for a new list query. An undefined
 * sort is the backend default, not a reason to skip a search reset.
 */
export const useResetMemoryList = <Sort extends string>({
  query,
  resetList,
  sort,
  viewMode,
}: UseResetMemoryListOptions<Sort>) => {
  const activeSort = viewMode === 'grid' ? sort : undefined;

  useLayoutEffect(() => {
    resetList({ q: query || undefined, sort: activeSort });
  }, [activeSort, query, resetList]);
};
