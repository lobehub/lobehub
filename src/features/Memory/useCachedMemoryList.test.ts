import { renderHook, waitFor } from '@testing-library/react';
import { type PropsWithChildren } from 'react';
import { createElement } from 'react';
import { type State, SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { userMemoryService } from '@/services/userMemory';
import { useUserMemoryStore } from '@/store/userMemory';
import { initialState } from '@/store/userMemory/initialState';

import { useResetMemoryList } from './useResetMemoryList';

const createSWRWrapper = () => {
  const value = {
    dedupingInterval: 60_000,
    provider: () => new Map<string, State>(),
  };

  return function SWRTestWrapper({ children }: PropsWithChildren) {
    return createElement(SWRConfig, { value }, children);
  };
};

const useActivitySearch = (query: string) => {
  const activities = useUserMemoryStore((state) => state.activities);
  const activitiesPage = useUserMemoryStore((state) => state.activitiesPage);
  const activitiesSearchLoading = useUserMemoryStore((state) => state.activitiesSearchLoading);
  const resetActivitiesList = useUserMemoryStore((state) => state.resetActivitiesList);
  const useFetchActivities = useUserMemoryStore((state) => state.useFetchActivities);

  useResetMemoryList({
    query,
    resetList: resetActivitiesList,
    viewMode: 'timeline',
  });
  useFetchActivities({ page: activitiesPage, pageSize: 12, q: query });

  return { activities, activitiesSearchLoading };
};

describe('cached memory list hydration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useUserMemoryStore.setState(initialState, false);
  });

  it('restores a cached search after switching away and back within the deduping interval', async () => {
    vi.spyOn(userMemoryService, 'queryActivities').mockImplementation(async (params) => ({
      items: [{ id: params?.q } as never],
      page: params?.page ?? 1,
      pageSize: params?.pageSize ?? 12,
      total: 1,
    }));

    const { rerender, result } = renderHook(({ query }) => useActivitySearch(query), {
      initialProps: { query: 'alpha' },
      wrapper: createSWRWrapper(),
    });

    await waitFor(() => {
      expect(result.current).toEqual({
        activities: [{ id: 'alpha' }],
        activitiesSearchLoading: false,
      });
    });

    rerender({ query: 'beta' });
    await waitFor(() => {
      expect(result.current).toEqual({
        activities: [{ id: 'beta' }],
        activitiesSearchLoading: false,
      });
    });

    rerender({ query: 'alpha' });
    await waitFor(() => {
      expect(result.current).toEqual({
        activities: [{ id: 'alpha' }],
        activitiesSearchLoading: false,
      });
    });
    expect(userMemoryService.queryActivities).toHaveBeenCalledTimes(2);
  });
});
