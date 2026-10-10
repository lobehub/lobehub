import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplicaState } from '@/libs/replica';
import { globalHelpers } from '@/store/global/helpers';
import type { McpListResponse } from '@/types/discover';

import { mcpSelectors } from '../../selectors';
import { useDiscoverStore as useStore } from '../../store';
import { mcpCategoriesQueryKey, mcpDetailQueryKey, mcpListQueryKey } from './projection';

vi.mock('@/services/discover', () => ({
  discoverService: {
    getMcpCategories: vi.fn(),
    getMcpDetail: vi.fn(),
    getMcpList: vi.fn(),
  },
}));

// The replica schedules its fetches through the app's SWR driver; the engine
// itself is what these tests exercise, so the driver is a bare recorder.
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

const makeList = (identifier = 'mcp-1'): McpListResponse =>
  ({
    currentPage: 1,
    items: [{ identifier } as any],
    pageSize: 21,
    totalCount: 1,
    totalPages: 1,
  }) as McpListResponse;

const emptyMcpState = () => ({
  mcpCategoriesMap: {},
  mcpCategoriesReplica: createReplicaState(),
  mcpDetailMap: {},
  mcpDetailReplica: createReplicaState(),
  mcpListMap: {},
  mcpListReplica: createReplicaState(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');
  useStore.setState(emptyMcpState());
});

/** The replica network syncs registered with the SWR driver, per resource name. */
const syncCalls = async (name: 'mcpCategories' | 'mcpDetail' | 'mcpList') => {
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

describe('MCPSlice (replica)', () => {
  describe('useFetchMcpList', () => {
    it('requests the list with normalized page / pageSize and the locale', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() => useStore.getState().useFetchMcpList({ q: 'github' }));

      const [call] = await syncCalls('mcpList');
      await call.fetcher();

      expect(discoverService.getMcpList).toHaveBeenCalledWith({
        locale: 'en-US',
        page: 1,
        pageSize: 21,
        q: 'github',
      });
    });

    it('keys each page and filter set as its own replica entry', () => {
      const { result } = renderHook(() => [
        useStore.getState().useFetchMcpList({ page: 1 }),
        useStore.getState().useFetchMcpList({ page: 2 }),
        useStore.getState().useFetchMcpList({ category: 'developer' }),
      ]);

      const [first, second, third] = result.current;
      expect(new Set([first.queryKey, second.queryKey, third.queryKey]).size).toBe(3);
    });

    it('does not register a sync — and reports no loading — when disabled', async () => {
      const { result } = renderHook(() =>
        useStore.getState().useFetchMcpList({ page: 1 }, { enabled: false }),
      );

      expect(result.current.queryKey).toBeUndefined();
      expect(result.current.isLoading).toBe(false);
      expect(await syncCalls('mcpList')).toHaveLength(0);
    });

    it('reports loading until the entry has a value to show', () => {
      const { result } = renderHook(() => useStore.getState().useFetchMcpList({ page: 1 }));

      expect(result.current.isLoading).toBe(true);
    });

    it('does not report loading when the entry already has a (hydrated) value', () => {
      const key = mcpListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 });
      useStore.setState({ mcpListMap: { [key]: makeList() } });

      const { result } = renderHook(() => useStore.getState().useFetchMcpList({ page: 1 }));

      expect(result.current.queryKey).toBe(key);
      expect(result.current.isLoading).toBe(false);
    });

    it('folds the response into the replica view the selectors read', async () => {
      const response = makeList();

      renderHook(() => useStore.getState().useFetchMcpList({ page: 1 }));
      const [call] = await syncCalls('mcpList');
      act(() => call.config.onSuccess!(response));

      const key = mcpListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 });
      expect(mcpSelectors.mcpList(key)(useStore.getState())).toEqual(response);
    });
  });

  describe('useFetchMcpDetail', () => {
    it('requests the detail with identifier, version and locale', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() =>
        useStore.getState().useFetchMcpDetail({ identifier: 'mcp-1', version: '1.0.0' }),
      );

      const [call] = await syncCalls('mcpDetail');
      await call.fetcher();

      expect(discoverService.getMcpDetail).toHaveBeenCalledWith({
        identifier: 'mcp-1',
        locale: 'en-US',
        version: '1.0.0',
      });
    });

    it('keys the detail by identifier, so a different identifier is a different entry', () => {
      const { result } = renderHook(() => [
        useStore.getState().useFetchMcpDetail({ identifier: 'mcp-1' }),
        useStore.getState().useFetchMcpDetail({ identifier: 'mcp-2' }),
      ]);

      expect(new Set(result.current.map((sync) => sync.queryKey)).size).toBe(2);
    });

    it('keys the detail by version, so a pinned version is a different entry', () => {
      const { result } = renderHook(() => [
        useStore.getState().useFetchMcpDetail({ identifier: 'mcp-1' }),
        useStore.getState().useFetchMcpDetail({ identifier: 'mcp-1', version: '1.0.0' }),
      ]);

      expect(new Set(result.current.map((sync) => sync.queryKey)).size).toBe(2);
    });

    it('keys the detail by the locale, so a language switch refetches', () => {
      const { result, rerender } = renderHook(() =>
        useStore.getState().useFetchMcpDetail({ identifier: 'mcp-1' }),
      );
      const first = result.current.queryKey;

      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('zh-CN');
      rerender();

      expect(result.current.queryKey).not.toBe(first);
    });

    it('does not register a sync — and reports no loading — without an identifier', async () => {
      const { result } = renderHook(() =>
        useStore.getState().useFetchMcpDetail({ identifier: undefined }),
      );

      expect(result.current.queryKey).toBeUndefined();
      expect(result.current.isLoading).toBe(false);
      expect(await syncCalls('mcpDetail')).toHaveLength(0);
    });

    it('does not register a sync for an empty identifier', async () => {
      const { result } = renderHook(() =>
        useStore.getState().useFetchMcpDetail({ identifier: '' }),
      );

      expect(result.current.queryKey).toBeUndefined();
      expect(await syncCalls('mcpDetail')).toHaveLength(0);
    });
  });

  describe('useMcpCategories', () => {
    it('requests category counts with the search term and the locale', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() => useStore.getState().useMcpCategories({ q: 'github' }));

      const [call] = await syncCalls('mcpCategories');
      await call.fetcher();

      expect(discoverService.getMcpCategories).toHaveBeenCalledWith({
        locale: 'en-US',
        q: 'github',
      });
    });

    it('skips the request when disabled', async () => {
      const { result } = renderHook(() =>
        useStore.getState().useMcpCategories({}, { enabled: false }),
      );

      expect(result.current.queryKey).toBeUndefined();
      expect(await syncCalls('mcpCategories')).toHaveLength(0);
    });

    it('falls back to an empty list when no category entry is loaded', () => {
      expect(mcpSelectors.mcpCategories(undefined)(useStore.getState())).toEqual([]);
      expect(mcpSelectors.mcpList(undefined)(useStore.getState())).toBeUndefined();
      expect(mcpSelectors.mcpDetail(undefined)(useStore.getState())).toBeUndefined();
    });
  });

  describe('replica key helpers', () => {
    it('produces stable, distinct keys per query dimension', () => {
      expect(mcpListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 })).toBe(
        mcpListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 }),
      );
      expect(mcpDetailQueryKey({ identifier: 'a' })).not.toBe(
        mcpDetailQueryKey({ identifier: 'b' }),
      );
      expect(mcpDetailQueryKey({ identifier: 'a' })).not.toBe(
        mcpDetailQueryKey({ identifier: 'a', version: '2.0.0' }),
      );
      expect(mcpCategoriesQueryKey({ q: 'a' })).not.toBe(mcpCategoriesQueryKey({}));
    });
  });
});
