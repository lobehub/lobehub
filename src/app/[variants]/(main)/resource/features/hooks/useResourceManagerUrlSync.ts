import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import { SortType } from '@/types/files';

/**
 * Hook to sync ResourceManager store state with URL query parameters
 * Store is the source of truth, URL is synced for bookmarking
 */
export const useResourceManagerUrlSync = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchQuery, sorter, sortType, viewMode, setSearchQuery, setSorter, setSortType] =
    useResourceManagerStore((s) => [
      s.searchQuery,
      s.sorter,
      s.sortType,
      s.viewMode,
      s.setSearchQuery,
      s.setSorter,
      s.setSortType,
    ]);

  // Initialize store from URL on mount (URL → Store)
  useEffect(() => {
    const q = searchParams.get('q');
    const sorterParam = (searchParams.get('sorter') || 'createdAt') as
      | 'name'
      | 'createdAt'
      | 'size';
    const sortTypeParam = (searchParams.get('sortType') || SortType.Desc) as SortType;

    setSearchQuery(q);
    setSorter(sorterParam);
    setSortType(sortTypeParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  // Sync store changes to URL (Store → URL)
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const newParams = new URLSearchParams(prev);

        // Search query
        if (searchQuery) {
          newParams.set('q', searchQuery);
        } else {
          newParams.delete('q');
        }

        // Sorter (clear if default)
        if (sorter === 'createdAt') {
          newParams.delete('sorter');
        } else {
          newParams.set('sorter', sorter);
        }

        // Sort type (clear if default)
        if (sortType === SortType.Desc) {
          newParams.delete('sortType');
        } else {
          newParams.set('sortType', sortType);
        }

        // View mode (clear if default)
        if (viewMode === 'list') {
          newParams.delete('view');
        } else {
          newParams.set('view', viewMode);
        }

        return newParams;
      },
      { replace: true },
    ); // Use replace to avoid polluting history
  }, [searchQuery, sorter, sortType, viewMode, setSearchParams]);
};
