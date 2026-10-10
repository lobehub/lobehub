import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createReplicaState } from '@/libs/replica';
import { globalHelpers } from '@/store/global/helpers';
import type { ProviderListResponse } from '@/types/discover';

import { providerSelectors } from '../../selectors';
import { useDiscoverStore as useStore } from '../../store';
import {
  providerDetailQueryKey,
  providerIdentifiersQueryKey,
  providerListQueryKey,
} from './projection';

vi.mock('@/services/discover', () => ({
  discoverService: {
    getProviderDetail: vi.fn(),
    getProviderIdentifiers: vi.fn(),
    getProviderList: vi.fn(),
  },
}));

// The replica schedules its fetches through the app's SWR driver; the engine
// itself is what these tests exercise, so the driver is a bare recorder.
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(() => ({ isValidating: false, mutate: vi.fn() })),
}));

const makeList = (identifier = 'openai'): ProviderListResponse => ({
  currentPage: 1,
  items: [{ identifier } as any],
  pageSize: 21,
  totalCount: 1,
  totalPages: 1,
});

const emptyProviderState = () => ({
  providerDetailMap: {},
  providerDetailReplica: createReplicaState(),
  providerIdentifiersMap: {},
  providerIdentifiersReplica: createReplicaState(),
  providerListMap: {},
  providerListReplica: createReplicaState(),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('en-US');
  useStore.setState(emptyProviderState());
});

/** The replica network syncs registered with the SWR driver, per resource name. */
const syncCalls = async (name: 'providerDetail' | 'providerIdentifiers' | 'providerList') => {
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

describe('ProviderSlice (replica)', () => {
  describe('useFetchProviderList', () => {
    it('requests the list with normalized page / pageSize and the locale', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() => useStore.getState().useFetchProviderList({ q: 'openai' }));

      const [call] = await syncCalls('providerList');
      await call.fetcher();

      expect(discoverService.getProviderList).toHaveBeenCalledWith({
        locale: 'en-US',
        page: 1,
        pageSize: 21,
        q: 'openai',
      });
    });

    it('keys each page and filter set as its own replica entry', () => {
      const { result } = renderHook(() => [
        useStore.getState().useFetchProviderList({ page: 1 }),
        useStore.getState().useFetchProviderList({ page: 2 }),
        useStore.getState().useFetchProviderList({ sort: 'identifier' as any }),
      ]);

      const [first, second, third] = result.current;
      expect(new Set([first.queryKey, second.queryKey, third.queryKey]).size).toBe(3);
    });

    it('does not register a sync — and reports no loading — when disabled', async () => {
      const { result } = renderHook(() =>
        useStore.getState().useFetchProviderList({ page: 1 }, { enabled: false }),
      );

      expect(result.current.queryKey).toBeUndefined();
      expect(result.current.isLoading).toBe(false);
      expect(await syncCalls('providerList')).toHaveLength(0);
    });

    it('reports loading until the entry has a value to show', () => {
      const { result } = renderHook(() => useStore.getState().useFetchProviderList({ page: 1 }));

      expect(result.current.isLoading).toBe(true);
    });

    it('does not report loading when the entry already has a (hydrated) value', () => {
      const key = providerListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 });
      useStore.setState({ providerListMap: { [key]: makeList() } });

      const { result } = renderHook(() => useStore.getState().useFetchProviderList({ page: 1 }));

      expect(result.current.queryKey).toBe(key);
      expect(result.current.isLoading).toBe(false);
    });

    it('folds the response into the replica view the selectors read', async () => {
      const response = makeList();

      renderHook(() => useStore.getState().useFetchProviderList({ page: 1 }));
      const [call] = await syncCalls('providerList');
      act(() => call.config.onSuccess!(response));

      const key = providerListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 });
      expect(providerSelectors.providerList(key)(useStore.getState())).toEqual(response);
    });
  });

  describe('useFetchProviderDetail', () => {
    it('requests the detail with identifier, readme flag and locale', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() =>
        useStore.getState().useFetchProviderDetail({ identifier: 'openai', withReadme: true }),
      );

      const [call] = await syncCalls('providerDetail');
      await call.fetcher();

      expect(discoverService.getProviderDetail).toHaveBeenCalledWith({
        identifier: 'openai',
        locale: 'en-US',
        withReadme: true,
      });
    });

    it('keys the detail by identifier, so a different identifier is a different entry', () => {
      const { result } = renderHook(() => [
        useStore.getState().useFetchProviderDetail({ identifier: 'openai' }),
        useStore.getState().useFetchProviderDetail({ identifier: 'anthropic' }),
      ]);

      expect(new Set(result.current.map((sync) => sync.queryKey)).size).toBe(2);
    });

    it('keys the detail by the readme flag, so the readme variant is its own entry', () => {
      const { result } = renderHook(() => [
        useStore.getState().useFetchProviderDetail({ identifier: 'openai' }),
        useStore.getState().useFetchProviderDetail({ identifier: 'openai', withReadme: true }),
      ]);

      expect(new Set(result.current.map((sync) => sync.queryKey)).size).toBe(2);
    });

    it('keys the detail by the locale, so a language switch refetches', () => {
      const { result, rerender } = renderHook(() =>
        useStore.getState().useFetchProviderDetail({ identifier: 'openai' }),
      );
      const first = result.current.queryKey;

      vi.spyOn(globalHelpers, 'getCurrentLanguage').mockReturnValue('zh-CN');
      rerender();

      expect(result.current.queryKey).not.toBe(first);
    });
  });

  describe('useFetchProviderIdentifiers', () => {
    it('requests the identifier index', async () => {
      const { discoverService } = await import('@/services/discover');

      renderHook(() => useStore.getState().useFetchProviderIdentifiers());

      const [call] = await syncCalls('providerIdentifiers');
      await call.fetcher();

      expect(discoverService.getProviderIdentifiers).toHaveBeenCalled();
    });

    it('falls back to undefined when no entry is loaded', () => {
      expect(providerSelectors.providerList(undefined)(useStore.getState())).toBeUndefined();
      expect(providerSelectors.providerDetail(undefined)(useStore.getState())).toBeUndefined();
      expect(providerSelectors.providerIdentifiers(undefined)(useStore.getState())).toBeUndefined();
    });
  });

  describe('replica key helpers', () => {
    it('produces stable, distinct keys per query dimension', () => {
      expect(providerListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 })).toBe(
        providerListQueryKey({ locale: 'en-US', page: 1, pageSize: 21 }),
      );
      expect(providerDetailQueryKey({ identifier: 'a' })).not.toBe(
        providerDetailQueryKey({ identifier: 'b' }),
      );
      expect(providerIdentifiersQueryKey()).toBe(providerIdentifiersQueryKey({}));
    });
  });
});
