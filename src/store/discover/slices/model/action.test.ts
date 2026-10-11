import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplicaState } from '@/libs/replica';
import { globalHelpers } from '@/store/global/helpers';
import type { ModelListResponse } from '@/types/discover';

import { modelSelectors } from '../../selectors';
import { useDiscoverStore as useStore } from '../../store';
import {
  modelCategoriesQueryKey,
  modelDetailQueryKey,
  modelIdentifiersQueryKey,
  modelListQueryKey,
} from './projection';

vi.mock('@/services/discover', () => ({
  discoverService: {
    getModelCategories: vi.fn(),
    getModelDetail: vi.fn(),
    getModelIdentifiers: vi.fn(),
    getModelList: vi.fn(),
  },
}));

// The replica schedules its fetches through the app's SWR driver; the engine
// itself is what these tests exercise, so the driver is a bare recorder.
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

const makeList = (identifier = 'model-1'): ModelListResponse => ({
  currentPage: 1,
  items: [{ identifier } as any],
  pageSize: 21,
  totalCount: 1,
  totalPages: 1,
});

const emptyModelState = () => ({
  modelCategoriesMap: {},
  modelCategoriesReplica: createReplicaState(),
  modelDetailMap: {},
  modelDetailReplica: createReplicaState(),
  modelIdentifiersMap: {},
  modelIdentifiersReplica: createReplicaState(),
  modelListMap: {},
  modelListReplica: createReplicaState(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');
  useStore.setState(emptyModelState());
});

/** The replica network syncs registered with the SWR driver, per resource name. */
const syncCalls = async (
  name: 'modelCategories' | 'modelDetail' | 'modelIdentifiers' | 'modelList',
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

describe('ModelSlice (replica)', () => {
  describe('useFetchModelList', () => {
    it('requests the list with normalized page / pageSize and the locale', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() => useStore.getState().useFetchModelList({ q: 'gpt' }));

      const [call] = await syncCalls('modelList');
      await call.fetcher();

      expect(discoverService.getModelList).toHaveBeenCalledWith({
        locale: 'en-US',
        page: 1,
        pageSize: 21,
        q: 'gpt',
      });
    });

    it('keys each page and filter set as its own replica entry', () => {
      const { result } = renderHook(() => [
        useStore.getState().useFetchModelList({ page: 1 }),
        useStore.getState().useFetchModelList({ page: 2 }),
        useStore.getState().useFetchModelList({ category: 'llm' }),
      ]);

      const [first, second, third] = result.current;
      expect(new Set([first.queryKey, second.queryKey, third.queryKey]).size).toBe(3);
    });

    it('does not register a sync — and reports no loading — when disabled', async () => {
      const { result } = renderHook(() =>
        useStore.getState().useFetchModelList({ page: 1 }, { enabled: false }),
      );

      expect(result.current.queryKey).toBeUndefined();
      expect(result.current.isLoading).toBe(false);
      expect(await syncCalls('modelList')).toHaveLength(0);
    });

    it('reports loading until the entry has a value to show', () => {
      const { result } = renderHook(() => useStore.getState().useFetchModelList({ page: 1 }));

      expect(result.current.isLoading).toBe(true);
    });

    it('does not report loading when the entry already has a (hydrated) value', () => {
      const key = modelListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 });
      useStore.setState({ modelListMap: { [key]: makeList() } });

      const { result } = renderHook(() => useStore.getState().useFetchModelList({ page: 1 }));

      expect(result.current.queryKey).toBe(key);
      expect(result.current.isLoading).toBe(false);
    });

    it('folds the response into the replica view the selectors read', async () => {
      const response = makeList();

      renderHook(() => useStore.getState().useFetchModelList({ page: 1 }));
      const [call] = await syncCalls('modelList');
      act(() => call.config.onSuccess!(response));

      const key = modelListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 });
      expect(modelSelectors.modelList(key)(useStore.getState())).toEqual(response);
    });
  });

  describe('useFetchModelDetail', () => {
    it('requests the detail with identifier and locale', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() => useStore.getState().useFetchModelDetail({ identifier: 'gpt-4' }));

      const [call] = await syncCalls('modelDetail');
      await call.fetcher();

      expect(discoverService.getModelDetail).toHaveBeenCalledWith({
        identifier: 'gpt-4',
        locale: 'en-US',
      });
    });

    it('keys the detail by identifier, so a different identifier is a different entry', () => {
      const { result } = renderHook(() => [
        useStore.getState().useFetchModelDetail({ identifier: 'gpt-4' }),
        useStore.getState().useFetchModelDetail({ identifier: 'claude-3' }),
      ]);

      expect(new Set(result.current.map((sync) => sync.queryKey)).size).toBe(2);
    });

    it('clears a cached detail once the market answers the identifier no longer exists', async () => {
      const { discoverService } = await import('@/services/discover');
      const key = modelDetailQueryKey({ identifier: 'gone', locale: 'en-US' });
      useStore.setState({
        modelDetailMap: { [key]: { model: { identifier: 'gone' } as any } },
      });
      vi.mocked(discoverService.getModelDetail).mockResolvedValue(undefined as any);

      const { result } = renderHook(() =>
        useStore.getState().useFetchModelDetail({ identifier: 'gone' }),
      );
      expect(modelSelectors.modelDetail(key)(useStore.getState())).toBeDefined();

      const [call] = await syncCalls('modelDetail');
      const fetched = await call.fetcher();
      act(() => call.config.onSuccess!(fetched));

      // The stale copy is gone and the entry is settled, so the page renders NotFound.
      expect(modelSelectors.modelDetail(key)(useStore.getState())).toBeUndefined();
      expect(useStore.getState().modelDetailMap[key]).toEqual({ model: null });
      expect(result.current.isLoading).toBe(false);
    });

    it('keys the detail by the locale, so a language switch refetches', () => {
      const { result, rerender } = renderHook(() =>
        useStore.getState().useFetchModelDetail({ identifier: 'gpt-4' }),
      );
      const first = result.current.queryKey;

      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('zh-CN');
      rerender();

      expect(result.current.queryKey).not.toBe(first);
    });
  });

  describe('useFetchModelCategories', () => {
    it('requests category counts with the search term', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() => useStore.getState().useFetchModelCategories({ q: 'gpt' }));

      const [call] = await syncCalls('modelCategories');
      await call.fetcher();

      expect(discoverService.getModelCategories).toHaveBeenCalledWith({ q: 'gpt' });
    });

    it('skips the request when disabled', async () => {
      const { result } = renderHook(() =>
        useStore.getState().useFetchModelCategories({}, { enabled: false }),
      );

      expect(result.current.queryKey).toBeUndefined();
      expect(await syncCalls('modelCategories')).toHaveLength(0);
    });

    it('falls back to an empty list when no category entry is loaded', () => {
      expect(modelSelectors.modelCategories(undefined)(useStore.getState())).toEqual([]);
      expect(modelSelectors.modelList(undefined)(useStore.getState())).toBeUndefined();
      expect(modelSelectors.modelDetail(undefined)(useStore.getState())).toBeUndefined();
    });
  });

  describe('useFetchModelIdentifiers', () => {
    it('requests the identifier index', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() => useStore.getState().useFetchModelIdentifiers());

      const [call] = await syncCalls('modelIdentifiers');
      await call.fetcher();

      expect(discoverService.getModelIdentifiers).toHaveBeenCalled();
    });
  });

  describe('replica key helpers', () => {
    it('produces stable, distinct keys per query dimension', () => {
      expect(modelListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 })).toBe(
        modelListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 }),
      );
      expect(modelDetailQueryKey({ identifier: 'a' })).not.toBe(
        modelDetailQueryKey({ identifier: 'b' }),
      );
      expect(modelCategoriesQueryKey({ q: 'a' })).not.toBe(modelCategoriesQueryKey({}));
      expect(modelIdentifiersQueryKey()).toBe(modelIdentifiersQueryKey({}));
    });
  });
});
