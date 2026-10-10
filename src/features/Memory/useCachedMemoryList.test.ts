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

describe('activity list store view', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useUserMemoryStore.setState(initialState, false);
  });

  // The activity list is a `@lobechat/replica` resource now: the flat `activities`
  // field is its view, and each query's rows land there as the network answers.
  it('repaints each query through the replica-backed store', async () => {
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

    // Every query re-reads through the replica's network sync: a stale cached
    // page never survives a query switch.
    const calledQueries = vi
      .mocked(userMemoryService.queryActivities)
      .mock.calls.map(([params]) => params?.q);
    expect(calledQueries).toContain('alpha');
    expect(calledQueries).toContain('beta');
  });
});
