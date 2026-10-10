import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplicaState } from '@/libs/replica';
import { globalHelpers } from '@/store/global/helpers';
import type { GroupAgentListResponse } from '@/types/discover';

import { groupAgentSelectors } from '../../selectors';
import { useDiscoverStore as useStore } from '../../store';
import {
  groupAgentCategoriesQueryKey,
  groupAgentDetailQueryKey,
  groupAgentIdentifiersQueryKey,
  groupAgentListQueryKey,
} from './projection';

vi.mock('@/services/discover', () => ({
  discoverService: {
    getGroupAgentCategories: vi.fn(),
    getGroupAgentDetail: vi.fn(),
    getGroupAgentIdentifiers: vi.fn(),
    getGroupAgentList: vi.fn(),
  },
}));

// The replica schedules its fetches through the app's SWR driver; the engine
// itself is what these tests exercise, so the driver is a bare recorder.
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

const makeList = (identifier = 'group-agent-1'): GroupAgentListResponse => ({
  currentPage: 1,
  items: [{ identifier } as any],
  totalCount: 1,
  totalPages: 1,
});

const emptyGroupAgentState = () => ({
  groupAgentCategoriesMap: {},
  groupAgentCategoriesReplica: createReplicaState(),
  groupAgentDetailMap: {},
  groupAgentDetailReplica: createReplicaState(),
  groupAgentIdentifiersMap: {},
  groupAgentIdentifiersReplica: createReplicaState(),
  groupAgentListMap: {},
  groupAgentListReplica: createReplicaState(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');
  useStore.setState(emptyGroupAgentState());
});

/** The replica network syncs registered with the SWR driver, per resource name. */
const syncCalls = async (
  name: 'groupAgentCategories' | 'groupAgentDetail' | 'groupAgentIdentifiers' | 'groupAgentList',
) => {
  const { useClientDataSWR } = await import('@/libs/swr');
  return vi
    .mocked(useClientDataSWR)
    .mock.calls.filter(
      ([key]) => Array.isArray(key) && key[0] === 'replica:sync' && key[1] === name,
    )
    .map(([key, fetcher, config]) => ({
      config: config as { onSuccess?: (data: unknown) => void },
      fetcher: fetcher as () => Promise<any>,
      key: key as unknown[],
    }));
};

describe('GroupAgentSlice (replica)', () => {
  describe('useFetchGroupAgentList', () => {
    it('requests the list with normalized page / pageSize and the locale', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() => useStore.getState().useFetchGroupAgentList({ q: 'coding' }));

      const [call] = await syncCalls('groupAgentList');
      await call.fetcher();

      expect(discoverService.getGroupAgentList).toHaveBeenCalledWith({
        locale: 'en-US',
        page: 1,
        pageSize: 20,
        q: 'coding',
      });
    });

    it('keys each page and filter set as its own replica entry', () => {
      const { result } = renderHook(() => [
        useStore.getState().useFetchGroupAgentList({ page: 1 }),
        useStore.getState().useFetchGroupAgentList({ page: 2 }),
        useStore.getState().useFetchGroupAgentList({ category: 'development' }),
      ]);

      const [first, second, third] = result.current;
      expect(new Set([first.queryKey, second.queryKey, third.queryKey]).size).toBe(3);
    });

    it('does not register a sync — and reports no loading — when disabled', async () => {
      const { result } = renderHook(() =>
        useStore.getState().useFetchGroupAgentList({ page: 1 }, { enabled: false }),
      );

      expect(result.current.queryKey).toBeUndefined();
      expect(result.current.isLoading).toBe(false);
      expect(await syncCalls('groupAgentList')).toHaveLength(0);
    });

    it('reports loading until the entry has a value to show', () => {
      const { result } = renderHook(() => useStore.getState().useFetchGroupAgentList({ page: 1 }));

      expect(result.current.isLoading).toBe(true);
    });

    it('does not report loading when the entry already has a (hydrated) value', () => {
      const key = groupAgentListQueryKey({ locale: 'en-US', page: 1, pageSize: 20 });
      useStore.setState({ groupAgentListMap: { [key]: makeList() } });

      const { result } = renderHook(() => useStore.getState().useFetchGroupAgentList({ page: 1 }));

      expect(result.current.queryKey).toBe(key);
      expect(result.current.isLoading).toBe(false);
    });

    it('folds the response into the replica view the selectors read', async () => {
      const response = makeList();

      renderHook(() => useStore.getState().useFetchGroupAgentList({ page: 1 }));
      const [call] = await syncCalls('groupAgentList');
      act(() => call.config.onSuccess!(response));

      const key = groupAgentListQueryKey({ locale: 'en-US', page: 1, pageSize: 20 });
      expect(groupAgentSelectors.groupAgentList(key)(useStore.getState())).toEqual(response);
    });
  });

  describe('useFetchGroupAgentDetail', () => {
    it('requests the detail with identifier / version / locale', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() =>
        useStore
          .getState()
          .useFetchGroupAgentDetail({ identifier: 'writing-team', version: '1.0.0' }),
      );

      const [call] = await syncCalls('groupAgentDetail');
      await call.fetcher();

      expect(discoverService.getGroupAgentDetail).toHaveBeenCalledWith({
        identifier: 'writing-team',
        locale: 'en-US',
        version: '1.0.0',
      });
    });

    it('keys the detail by identifier and version', () => {
      const { result } = renderHook(() => [
        useStore.getState().useFetchGroupAgentDetail({ identifier: 'writing-team' }),
        useStore
          .getState()
          .useFetchGroupAgentDetail({ identifier: 'writing-team', version: '1.0.0' }),
        useStore.getState().useFetchGroupAgentDetail({ identifier: 'research-team' }),
      ]);

      expect(new Set(result.current.map((sync) => sync.queryKey)).size).toBe(3);
    });

    it('keys the detail by the locale, so a language switch refetches', () => {
      const { result, rerender } = renderHook(() =>
        useStore.getState().useFetchGroupAgentDetail({ identifier: 'writing-team' }),
      );
      const first = result.current.queryKey;

      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('zh-CN');
      rerender();

      expect(result.current.queryKey).not.toBe(first);
    });
  });

  describe('useFetchGroupAgentCategories', () => {
    it('requests category counts with the search term and locale', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() => useStore.getState().useFetchGroupAgentCategories({ q: 'coding' }));

      const [call] = await syncCalls('groupAgentCategories');
      await call.fetcher();

      expect(discoverService.getGroupAgentCategories).toHaveBeenCalledWith({
        locale: 'en-US',
        q: 'coding',
      });
    });

    it('skips the request when disabled', async () => {
      const { result } = renderHook(() =>
        useStore.getState().useFetchGroupAgentCategories({}, { enabled: false }),
      );

      expect(result.current.queryKey).toBeUndefined();
      expect(await syncCalls('groupAgentCategories')).toHaveLength(0);
    });

    it('falls back to an empty list when no category entry is loaded', () => {
      expect(groupAgentSelectors.groupAgentCategories(undefined)(useStore.getState())).toEqual([]);
      expect(groupAgentSelectors.groupAgentList(undefined)(useStore.getState())).toBeUndefined();
      expect(groupAgentSelectors.groupAgentDetail(undefined)(useStore.getState())).toBeUndefined();
    });
  });

  describe('useFetchGroupAgentIdentifiers', () => {
    it('requests the identifier index of the market', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() => useStore.getState().useFetchGroupAgentIdentifiers());

      const [call] = await syncCalls('groupAgentIdentifiers');
      await call.fetcher();

      expect(discoverService.getGroupAgentIdentifiers).toHaveBeenCalled();
    });
  });

  describe('replica key helpers', () => {
    it('produces stable, distinct keys per query dimension', () => {
      expect(groupAgentListQueryKey({ locale: 'en-US', page: 1, pageSize: 20 })).toBe(
        groupAgentListQueryKey({ locale: 'en-US', page: 1, pageSize: 20 }),
      );
      expect(groupAgentDetailQueryKey({ identifier: 'a' })).not.toBe(
        groupAgentDetailQueryKey({ identifier: 'b' }),
      );
      expect(groupAgentCategoriesQueryKey({ q: 'a' })).not.toBe(groupAgentCategoriesQueryKey({}));
      expect(groupAgentIdentifiersQueryKey()).toBe(groupAgentIdentifiersQueryKey({}));
    });
  });
});
