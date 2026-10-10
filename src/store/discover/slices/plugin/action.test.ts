import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplicaState } from '@/libs/replica';
import { globalHelpers } from '@/store/global/helpers';
import type { PluginListResponse } from '@/types/discover';

import { pluginSelectors } from '../../selectors';
import { useDiscoverStore as useStore } from '../../store';
import {
  pluginCategoriesQueryKey,
  pluginDetailQueryKey,
  pluginIdentifiersQueryKey,
  pluginListQueryKey,
} from './projection';

vi.mock('@/services/discover', () => ({
  discoverService: {
    getPluginCategories: vi.fn(),
    getPluginDetail: vi.fn(),
    getPluginIdentifiers: vi.fn(),
    getPluginList: vi.fn(),
  },
}));

// The replica schedules its fetches through the app's SWR driver; the engine
// itself is what these tests exercise, so the driver is a bare recorder.
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

const makeList = (identifier = 'plugin-1'): PluginListResponse => ({
  currentPage: 1,
  items: [{ identifier } as any],
  pageSize: 21,
  totalCount: 1,
  totalPages: 1,
});

const emptyPluginState = () => ({
  pluginCategoriesMap: {},
  pluginCategoriesReplica: createReplicaState(),
  pluginDetailMap: {},
  pluginDetailReplica: createReplicaState(),
  pluginIdentifiersMap: {},
  pluginIdentifiersReplica: createReplicaState(),
  pluginListMap: {},
  pluginListReplica: createReplicaState(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');
  useStore.setState(emptyPluginState());
});

/** The replica network syncs registered with the SWR driver, per resource name. */
const syncCalls = async (
  name: 'pluginCategories' | 'pluginDetail' | 'pluginIdentifiers' | 'pluginList',
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

describe('PluginSlice (replica)', () => {
  describe('useFetchPluginList', () => {
    it('requests the list with normalized page / pageSize and the locale', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() => useStore.getState().useFetchPluginList({ q: 'weather' }));

      const [call] = await syncCalls('pluginList');
      await call.fetcher();

      expect(discoverService.getPluginList).toHaveBeenCalledWith({
        locale: 'en-US',
        page: 1,
        pageSize: 21,
        q: 'weather',
      });
    });

    it('keys each page and filter set as its own replica entry', () => {
      const { result } = renderHook(() => [
        useStore.getState().useFetchPluginList({ page: 1 }),
        useStore.getState().useFetchPluginList({ page: 2 }),
        useStore.getState().useFetchPluginList({ category: 'tools' }),
      ]);

      const [first, second, third] = result.current;
      expect(new Set([first.queryKey, second.queryKey, third.queryKey]).size).toBe(3);
    });

    it('does not register a sync — and reports no loading — when disabled', async () => {
      const { result } = renderHook(() =>
        useStore.getState().useFetchPluginList({ page: 1 }, { enabled: false }),
      );

      expect(result.current.queryKey).toBeUndefined();
      expect(result.current.isLoading).toBe(false);
      expect(await syncCalls('pluginList')).toHaveLength(0);
    });

    it('reports loading until the entry has a value to show', () => {
      const { result } = renderHook(() => useStore.getState().useFetchPluginList({ page: 1 }));

      expect(result.current.isLoading).toBe(true);
    });

    it('does not report loading when the entry already has a (hydrated) value', () => {
      const key = pluginListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 });
      useStore.setState({ pluginListMap: { [key]: makeList() } });

      const { result } = renderHook(() => useStore.getState().useFetchPluginList({ page: 1 }));

      expect(result.current.queryKey).toBe(key);
      expect(result.current.isLoading).toBe(false);
    });

    it('folds the response into the replica view the selectors read', async () => {
      const response = makeList();

      renderHook(() => useStore.getState().useFetchPluginList({ page: 1 }));
      const [call] = await syncCalls('pluginList');
      act(() => call.config.onSuccess!(response));

      const key = pluginListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 });
      expect(pluginSelectors.pluginList(key)(useStore.getState())).toEqual(response);
    });
  });

  describe('useFetchPluginDetail', () => {
    it('requests the detail with identifier, locale and the manifest flag', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() =>
        useStore.getState().useFetchPluginDetail({ identifier: 'plugin-1', withManifest: false }),
      );

      const [call] = await syncCalls('pluginDetail');
      await call.fetcher();

      expect(discoverService.getPluginDetail).toHaveBeenCalledWith({
        identifier: 'plugin-1',
        locale: 'en-US',
        withManifest: false,
      });
    });

    it('keys the detail by identifier, so a different identifier is a different entry', () => {
      const { result } = renderHook(() => [
        useStore.getState().useFetchPluginDetail({ identifier: 'plugin-1', withManifest: false }),
        useStore.getState().useFetchPluginDetail({ identifier: 'plugin-2', withManifest: false }),
      ]);

      expect(new Set(result.current.map((sync) => sync.queryKey)).size).toBe(2);
    });

    it('keys the detail by the locale, so a language switch refetches', () => {
      const { result, rerender } = renderHook(() =>
        useStore.getState().useFetchPluginDetail({ identifier: 'plugin-1', withManifest: false }),
      );
      const first = result.current.queryKey;

      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('zh-CN');
      rerender();

      expect(result.current.queryKey).not.toBe(first);
    });

    it('does not register a sync — and exposes no queryKey — when the identifier is absent', async () => {
      const { result } = renderHook(() =>
        useStore.getState().useFetchPluginDetail({ identifier: undefined, withManifest: false }),
      );

      expect(result.current.queryKey).toBeUndefined();
      expect(result.current.isLoading).toBe(false);
      expect(await syncCalls('pluginDetail')).toHaveLength(0);
    });
  });

  describe('useFetchPluginCategories', () => {
    it('requests category counts with the search term', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() => useStore.getState().useFetchPluginCategories({ q: 'weather' }));

      const [call] = await syncCalls('pluginCategories');
      await call.fetcher();

      expect(discoverService.getPluginCategories).toHaveBeenCalledWith({ q: 'weather' });
    });

    it('skips the request when disabled', async () => {
      const { result } = renderHook(() =>
        useStore.getState().useFetchPluginCategories({}, { enabled: false }),
      );

      expect(result.current.queryKey).toBeUndefined();
      expect(await syncCalls('pluginCategories')).toHaveLength(0);
    });

    it('falls back to an empty list when no category entry is loaded', () => {
      expect(pluginSelectors.pluginCategories(undefined)(useStore.getState())).toEqual([]);
      expect(pluginSelectors.pluginList(undefined)(useStore.getState())).toBeUndefined();
      expect(pluginSelectors.pluginDetail(undefined)(useStore.getState())).toBeUndefined();
    });
  });

  describe('useFetchPluginIdentifiers', () => {
    it('requests the identifier index', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() => useStore.getState().useFetchPluginIdentifiers());

      const [call] = await syncCalls('pluginIdentifiers');
      await call.fetcher();

      expect(discoverService.getPluginIdentifiers).toHaveBeenCalled();
    });
  });

  describe('replica key helpers', () => {
    it('produces stable, distinct keys per query dimension', () => {
      expect(pluginListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 })).toBe(
        pluginListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 }),
      );
      expect(pluginDetailQueryKey({ identifier: 'a', withManifest: false })).not.toBe(
        pluginDetailQueryKey({ identifier: 'b', withManifest: false }),
      );
      expect(pluginDetailQueryKey({ identifier: 'a', withManifest: false })).not.toBe(
        pluginDetailQueryKey({ identifier: 'a', withManifest: true }),
      );
      expect(pluginCategoriesQueryKey({ q: 'a' })).not.toBe(pluginCategoriesQueryKey({}));
      expect(pluginIdentifiersQueryKey()).toBe(pluginIdentifiersQueryKey({}));
    });
  });
});
