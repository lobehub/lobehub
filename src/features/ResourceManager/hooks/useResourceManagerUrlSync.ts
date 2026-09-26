import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { SortType } from '@/types/files';

import { getResourceSortParams } from './resourceSortParams';

/**
 * Hook to sync ResourceManager store state with URL query parameters
 * Store is the source of truth, URL is synced for bookmarking
 */
export const useResourceManagerUrlSync = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const [sorter, sortType, setSorter, setSortType] = useResourceManagerStore((s) => [
    s.sorter,
    s.sortType,
    s.setSorter,
    s.setSortType,
  ]);

  // Initialize store from URL on mount (URL → Store)
  useEffect(() => {
    const { sorter: sorterParam, sortType: sortTypeParam } = getResourceSortParams(searchParams);

    setSorter(sorterParam);
    setSortType(sortTypeParam);
  }, []); // Only on mount

  // Sync store changes to URL (Store → URL)
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const newParams = new URLSearchParams(prev);

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

        return newParams;
      },
      { replace: true },
    ); // Use replace to avoid polluting history
  }, [sorter, sortType, setSearchParams]);
};
