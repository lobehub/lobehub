import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { initialState } from '@/features/ResourceManager/store/initialState';
import { explorerSearchResource } from '@/features/ResourceManager/store/projection';
import { getExplorerSearchParams } from '@/features/ResourceManager/store/selectors';
import type { ResourceItem } from '@/types/resource';

import { useExplorerSearchResults } from './useExplorerSearchResults';

const row = (id: string): ResourceItem => ({ fileType: 'application/pdf', id, name: `${id}.pdf` });

const seedSearch = (hasMore: boolean) => {
  useResourceManagerStore.setState({ searchQuery: 'report' });
  const params = getExplorerSearchParams(useResourceManagerStore.getState())!;
  const key = explorerSearchResource.key(params);

  useResourceManagerStore.setState({
    explorerSearchEntries: {
      [key]: {
        currentPage: 0,
        hasMore,
        items: [row('hit-1'), row('hit-2')],
        pageSize: 50,
        searchParams: params,
        total: hasMore ? 120 : 2,
      },
    },
  });

  return key;
};

describe('useExplorerSearchResults', () => {
  const loadMoreExplorerSearch = vi.fn();

  beforeEach(() => {
    loadMoreExplorerSearch.mockReset().mockResolvedValue(undefined);
    useResourceManagerStore.setState({
      ...initialState,
      loadMoreExplorerSearch,
      useFetchExplorerSearch: () => ({ error: undefined, revalidate: vi.fn() }) as any,
    });
  });

  it('should stay idle while no keyword is typed', () => {
    const { result } = renderHook(() => useExplorerSearchResults());

    expect(result.current).toMatchObject({ data: [], isLoading: false, searchParams: null });
  });

  it('should expose the hits of the query on screen', () => {
    seedSearch(true);

    const { result } = renderHook(() => useExplorerSearchResults());

    expect(result.current.data.map((item) => item.id)).toEqual(['hit-1', 'hit-2']);
    expect(result.current).toMatchObject({ hasMore: true, isLoading: false, total: 120 });
  });

  // Regression: a failed page past the head was dropped on the floor — the
  // loading row disappeared while more rows remained. The overlay needs the
  // error to render a retry at the tail.
  it('should surface a failed next page of the query on screen', () => {
    const key = seedSearch(true);
    const loadMoreError = new Error('page 2 failed');
    const entry = useResourceManagerStore.getState().explorerSearchEntries[key];

    useResourceManagerStore.setState({
      explorerSearchEntries: { [key]: { ...entry, loadMoreError } },
    });

    const { result } = renderHook(() => useExplorerSearchResults());

    expect(result.current.loadMoreError).toBe(loadMoreError);
  });

  // Regression: the overlay never requested the next page, so a keyword with
  // more than one page of hits only ever showed the first 50.
  it('should load the next page of the query on screen', async () => {
    const key = seedSearch(true);

    const { result } = renderHook(() => useExplorerSearchResults());
    await act(() => result.current.loadMore());

    expect(loadMoreExplorerSearch).toHaveBeenCalledWith(key);
  });
});
