/**
 * @vitest-environment happy-dom
 *
 * SWR keeps request state in memory only. The removed persistence layer (a
 * tiered SWR cache provider writing to the local database `swr-cache`
 * collection and `lobechat-swr-cache:*` localStorage entries) must not come
 * back: the app's provider installs no cache provider and writes nothing.
 */
import 'fake-indexeddb/auto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { useSyncExternalStore } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { localDatabase } from '@/libs/localDatabase';

import QueryProvider from './Query';

const scopeStore = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let scope = 'u1:personal';
  return {
    get: () => scope,
    set: (next: string) => {
      scope = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: scopeStore.get,
  isScopeTrusted: () => true,
  useCacheScope: () => useSyncExternalStore(scopeStore.subscribe, scopeStore.get),
  useIsScopeTrusted: () => true,
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaQuery: { Provider: ({ children }: PropsWithChildren) => children },
  lambdaQueryClient: {},
}));

// Keys from every domain the removed provider used to persist.
const FORMERLY_PERSISTED_KEYS = [
  ['message:list', { agentId: 'agt_1', topicId: 'tpc_1' }, 2],
  ['topic:search', 'weather'],
  ['agent:list', true],
  ['recent:topicList', 10],
  ['taskTemplate:daily', 'en-US'],
  ['modelConfig:lobehub'],
] as const;

const fetchPayload = async () => ({ rows: ['payload'] });

beforeEach(() => {
  scopeStore.set('u1:personal');
  localStorage.clear();
});

afterEach(async () => {
  vi.useRealTimers();
  await localDatabase.deleteByPrefix('swr-cache', '');
  localStorage.clear();
});

describe('QueryProvider SWR cache', () => {
  it('installs no SWR cache provider: hooks use the default in-memory cache', () => {
    const outside = renderHook(() => useSWRConfig().cache);
    const inside = renderHook(() => useSWRConfig().cache, { wrapper: QueryProvider });

    expect(inside.result.current).toBe(outside.result.current);
  });

  it('persists nothing to the local database or localStorage', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });

    const { result } = renderHook(
      () => FORMERLY_PERSISTED_KEYS.map((key) => useSWR(key, fetchPayload).data),
      { wrapper: QueryProvider },
    );

    await waitFor(() => expect(result.current.every(Boolean)).toBe(true));
    // Well past the removed provider's 2s write debounce.
    await act(() => vi.advanceTimersByTimeAsync(10_000));

    expect(await localDatabase.entriesByPrefix('swr-cache', '')).toEqual([]);
    expect(Object.keys(localStorage).filter((key) => key.includes('swr-cache'))).toEqual([]);
  });

  it('drops cached values when the scope changes, so the previous scope never repaints', async () => {
    let resolveSecond: ((value: string) => void) | undefined;
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('u1 data')
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)));

    const { result } = renderHook(() => useSWR(['agent:scopeStable', 'agt_1'], fetcher).data, {
      wrapper: QueryProvider,
    });
    await waitFor(() => expect(result.current).toBe('u1 data'));

    act(() => scopeStore.set('u2:personal'));

    await waitFor(() => expect(result.current).toBeUndefined());
    await act(async () => resolveSecond?.('u2 data'));
    await waitFor(() => expect(result.current).toBe('u2 data'));
  });
});
