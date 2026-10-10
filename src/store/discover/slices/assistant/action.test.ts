import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplicaState } from '@/libs/replica';
import { globalHelpers } from '@/store/global/helpers';
import type { AssistantListResponse } from '@/types/discover';

import { assistantSelectors } from '../../selectors';
import { useDiscoverStore as useStore } from '../../store';
import {
  assistantCategoriesQueryKey,
  assistantDetailQueryKey,
  assistantIdentifiersQueryKey,
  assistantListQueryKey,
} from './projection';

vi.mock('@/services/discover', () => ({
  discoverService: {
    getAssistantCategories: vi.fn(),
    getAssistantDetail: vi.fn(),
    getAssistantIdentifiers: vi.fn(),
    getAssistantList: vi.fn(),
  },
}));

// The replica schedules its fetches through the app's SWR driver; the engine
// itself is what these tests exercise, so the driver is a bare recorder.
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

const makeList = (identifier = 'assistant-1'): AssistantListResponse => ({
  currentPage: 1,
  items: [{ identifier } as any],
  pageSize: 21,
  totalCount: 1,
  totalPages: 1,
});

const emptyAssistantState = () => ({
  assistantCategoriesMap: {},
  assistantCategoriesReplica: createReplicaState(),
  assistantDetailMap: {},
  assistantDetailReplica: createReplicaState(),
  assistantIdentifiersMap: {},
  assistantIdentifiersReplica: createReplicaState(),
  assistantListMap: {},
  assistantListReplica: createReplicaState(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');
  useStore.setState(emptyAssistantState());
});

/** The replica network syncs registered with the SWR driver, per resource name. */
const syncCalls = async (
  name: 'assistantCategories' | 'assistantDetail' | 'assistantIdentifiers' | 'assistantList',
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

describe('AssistantSlice (replica)', () => {
  describe('useFetchAssistantList', () => {
    it('requests the list with normalized page / pageSize and the locale', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() => useStore.getState().useFetchAssistantList({ q: 'coding' }));

      const [call] = await syncCalls('assistantList');
      await call.fetcher();

      expect(discoverService.getAssistantList).toHaveBeenCalledWith({
        locale: 'en-US',
        page: 1,
        pageSize: 21,
        q: 'coding',
      });
    });

    it('keys each page and filter set as its own replica entry', () => {
      const { result } = renderHook(() => [
        useStore.getState().useFetchAssistantList({ page: 1 }),
        useStore.getState().useFetchAssistantList({ page: 2 }),
        useStore.getState().useFetchAssistantList({ category: 'programming' }),
      ]);

      const [first, second, third] = result.current;
      expect(new Set([first.queryKey, second.queryKey, third.queryKey]).size).toBe(3);
    });

    it('does not register a sync — and reports no loading — when disabled', async () => {
      const { result } = renderHook(() =>
        useStore.getState().useFetchAssistantList({ page: 1 }, { enabled: false }),
      );

      expect(result.current.queryKey).toBeUndefined();
      expect(result.current.isLoading).toBe(false);
      expect(await syncCalls('assistantList')).toHaveLength(0);
    });

    it('reports loading until the entry has a value to show', () => {
      const { result } = renderHook(() => useStore.getState().useFetchAssistantList({ page: 1 }));

      expect(result.current.isLoading).toBe(true);
    });

    it('does not report loading when the entry already has a (hydrated) value', () => {
      const key = assistantListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 });
      useStore.setState({ assistantListMap: { [key]: makeList() } });

      const { result } = renderHook(() => useStore.getState().useFetchAssistantList({ page: 1 }));

      expect(result.current.queryKey).toBe(key);
      expect(result.current.isLoading).toBe(false);
    });

    it('folds the response into the replica view the selectors read', async () => {
      const response = makeList();

      renderHook(() => useStore.getState().useFetchAssistantList({ page: 1 }));
      const [call] = await syncCalls('assistantList');
      act(() => call.config.onSuccess!(response));

      const key = assistantListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 });
      expect(assistantSelectors.assistantList(key)(useStore.getState())).toEqual(response);
    });
  });

  describe('useFetchAssistantDetail', () => {
    it('requests the detail with identifier / source / version / locale', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() =>
        useStore
          .getState()
          .useFetchAssistantDetail({ identifier: 'lobe-chat', source: 'new', version: '1.0.0' }),
      );

      const [call] = await syncCalls('assistantDetail');
      await call.fetcher();

      expect(discoverService.getAssistantDetail).toHaveBeenCalledWith({
        identifier: 'lobe-chat',
        locale: 'en-US',
        source: 'new',
        version: '1.0.0',
      });
    });

    it('keys the detail by identifier, source and version', () => {
      const { result } = renderHook(() => [
        useStore.getState().useFetchAssistantDetail({ identifier: 'lobe-chat' }),
        useStore.getState().useFetchAssistantDetail({ identifier: 'lobe-chat', source: 'new' }),
        useStore.getState().useFetchAssistantDetail({ identifier: 'lobe-chat', version: '1.0.0' }),
      ]);

      expect(new Set(result.current.map((sync) => sync.queryKey)).size).toBe(3);
    });

    it('keys the detail by the locale, so a language switch refetches', () => {
      const { result, rerender } = renderHook(() =>
        useStore.getState().useFetchAssistantDetail({ identifier: 'lobe-chat' }),
      );
      const first = result.current.queryKey;

      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('zh-CN');
      rerender();

      expect(result.current.queryKey).not.toBe(first);
    });
  });

  describe('useFetchAssistantCategories', () => {
    it('requests category counts with the search term and locale', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() =>
        useStore.getState().useFetchAssistantCategories({ q: 'coding', source: 'new' }),
      );

      const [call] = await syncCalls('assistantCategories');
      await call.fetcher();

      expect(discoverService.getAssistantCategories).toHaveBeenCalledWith({
        locale: 'en-US',
        q: 'coding',
        source: 'new',
      });
    });

    it('skips the request when disabled (the list already carries the counts)', async () => {
      const { result } = renderHook(() =>
        useStore.getState().useFetchAssistantCategories({}, { enabled: false }),
      );

      expect(result.current.queryKey).toBeUndefined();
      expect(await syncCalls('assistantCategories')).toHaveLength(0);
    });

    it('falls back to an empty list when no category entry is loaded', () => {
      expect(assistantSelectors.assistantCategories(undefined)(useStore.getState())).toEqual([]);
      expect(assistantSelectors.assistantList(undefined)(useStore.getState())).toBeUndefined();
      expect(assistantSelectors.assistantDetail(undefined)(useStore.getState())).toBeUndefined();
    });
  });

  describe('useFetchAssistantIdentifiers', () => {
    it('requests the identifier index of a source', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() => useStore.getState().useFetchAssistantIdentifiers({ source: 'new' }));

      const [call] = await syncCalls('assistantIdentifiers');
      await call.fetcher();

      expect(discoverService.getAssistantIdentifiers).toHaveBeenCalledWith({ source: 'new' });
    });
  });

  describe('replica key helpers', () => {
    it('produces stable, distinct keys per query dimension', () => {
      expect(assistantListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 })).toBe(
        assistantListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 }),
      );
      expect(assistantDetailQueryKey({ identifier: 'a' })).not.toBe(
        assistantDetailQueryKey({ identifier: 'b' }),
      );
      expect(assistantCategoriesQueryKey({ q: 'a' })).not.toBe(assistantCategoriesQueryKey({}));
      expect(assistantIdentifiersQueryKey({ source: 'new' })).not.toBe(
        assistantIdentifiersQueryKey({}),
      );
    });
  });
});
