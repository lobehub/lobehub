import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { getDefaultLibrarySort } from '@/features/ResourceManager/store/selectors';
import { SortType } from '@/types/files';
import type { ResourceSorter } from '@/types/resource';

const validSorters = new Set<ResourceSorter>(['custom', 'name', 'createdAt', 'size']);

/** Store owns folder navigation; URL supplies explicit settings on surface entry. */
export const useResourceManagerUrlSync = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [libraryId, sorter, sortType, setSort] = useResourceManagerStore((s) => [
    s.libraryId,
    s.sorter,
    s.sortType,
    s.setSort,
  ]);
  const surface = useRef<{ libraryId?: string } | null>(null);

  useEffect(() => {
    const defaults = getDefaultLibrarySort(libraryId);
    if (!surface.current || surface.current.libraryId !== libraryId) {
      const firstMount = !surface.current;
      surface.current = { libraryId };
      const sorterParam = searchParams.get('sorter') as ResourceSorter;
      const typeParam = searchParams.get('sortType');
      // setLibraryId applies defaults on a surface switch. On remount within
      // that surface keep its active settings when navigation omitted the URL.
      const initializedForLibrary = useResourceManagerStore.getState().sortLibraryId === libraryId;
      const fallback = firstMount && initializedForLibrary ? { sorter, sortType } : defaults;
      const nextSorter = validSorters.has(sorterParam) ? sorterParam : fallback.sorter;
      const nextType =
        typeParam === SortType.Asc || typeParam === SortType.Desc ? typeParam : fallback.sortType;
      if (nextSorter !== sorter || nextType !== sortType) {
        setSort(nextSorter, nextType);
        return;
      }
    }

    const next = new URLSearchParams(searchParams);
    if (sorter === defaults.sorter) next.delete('sorter');
    else next.set('sorter', sorter);
    if (sortType === defaults.sortType) next.delete('sortType');
    else next.set('sortType', sortType);
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [libraryId, sorter, sortType, searchParams, setSearchParams, setSort]);
};
