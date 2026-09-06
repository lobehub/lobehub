/**
 * @vitest-environment happy-dom
 *
 * Guards the store-sync contract of `useClientDataSWRWithSync`.
 *
 * This is the exact path that drives the conversation `messagesInit` gate:
 *   ChatList → useFetchMessages → useClientDataSWRWithSync(key, fetcher, { onData })
 *   onData sets `messagesInit: true`.
 * SWR fires `onSuccess` only for a completed network fetch (with the fetched
 * value), never for a cache hit — so `onData` must be driven from `response.data`.
 * A switch to a topic whose messages are already in the SWR cache must fire
 * `onData` from cache — otherwise the skeleton stays up until the network fetch
 * lands (cached data not shown first). A single `data`-keyed effect does this
 * with no two-effect ordering race and no render-phase write.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren, StrictMode } from 'react';
import { type Cache, SWRConfig, unstable_serialize } from 'swr';
import useSWR from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, useStore } from 'zustand';

import { useClientDataSWRWithSync } from './useClientDataSWRWithSync';

const KEY_A = ['message:list', 'topic-A'];
const KEY_B = ['message:list', 'topic-B'];
const DATA_A = [{ id: 'a1' }];
const DATA_B = [{ id: 'b1' }];

// A single shared SWR cache Map, mimicking the app-level tiered provider once it
// has been hydrated from IndexedDB (data is present synchronously).
const makeSharedProvider = () => {
  const map = new Map<string, unknown>();
  return { map, provider: () => map };
};

const wrapper =
  (provider: () => Map<string, unknown>, strict = false) =>
  ({ children }: PropsWithChildren) => {
    const tree = createElement(
      SWRConfig,
      { value: { provider: provider as unknown as (c: Readonly<Cache>) => Cache } },
      children,
    );
    return strict ? createElement(StrictMode, null, tree) : tree;
  };

// Warm the shared cache for a key by running one real fetch through SWR, then
// unmounting. The provider Map keeps the entry afterwards.
const warm = async (provider: () => Map<string, unknown>, key: unknown, data: unknown) => {
  const r = renderHook(() => useSWR(key, () => Promise.resolve(data)), {
    wrapper: wrapper(provider),
  });
  await waitFor(() => expect(r.result.current.data).toEqual(data));
  r.unmount();
};

const neverFetch = () => new Promise<any>(() => {});

describe('useClientDataSWRWithSync — cache-first store sync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serves both topics synchronously from the warmed provider (sanity)', async () => {
    const { map, provider } = makeSharedProvider();
    await warm(provider, KEY_A, DATA_A);
    await warm(provider, KEY_B, DATA_B);

    expect(map.has(unstable_serialize(KEY_A))).toBe(true);
    expect(map.has(unstable_serialize(KEY_B))).toBe(true);
  });

  it('fires onData for cached data immediately on a topic switch (no network)', async () => {
    const { provider } = makeSharedProvider();
    await warm(provider, KEY_A, DATA_A);
    await warm(provider, KEY_B, DATA_B);

    const synced: unknown[] = [];

    // Mimic the real call site: a fresh `onData` closure every render (it is an
    // inline arrow in the store action).
    const { rerender } = renderHook(
      ({ key }: { key: unknown }) =>
        useClientDataSWRWithSync<any>(key, neverFetch, {
          onData: (data) => synced.push(data),
        }),
      { initialProps: { key: KEY_A as unknown }, wrapper: wrapper(provider) },
    );

    // Topic A synced from cache.
    expect(synced).toContainEqual(DATA_A);

    // Extra renders on A — the old two-effect version left a `hasSyncedRef` at
    // `true` here, which then dropped the switch. The data-keyed effect must not.
    act(() => rerender({ key: KEY_A }));
    act(() => rerender({ key: KEY_A }));

    const before = synced.length;

    // Switch to topic B (already cached). onData(DATA_B) must fire from cache,
    // WITHOUT the never-resolving fetcher ever completing.
    act(() => rerender({ key: KEY_B }));
    expect(synced.slice(before)).toContainEqual(DATA_B);
  });

  it('does not re-fire onData for a stable cached snapshot across re-renders', async () => {
    const { provider } = makeSharedProvider();
    await warm(provider, KEY_A, DATA_A);

    const onData = vi.fn();
    const { rerender } = renderHook(
      () => useClientDataSWRWithSync<any>(KEY_A, neverFetch, { onData }),
      { wrapper: wrapper(provider) },
    );

    expect(onData).toHaveBeenCalledTimes(1);
    act(() => rerender());
    act(() => rerender());
    // Same key, same cached reference → no duplicate deliveries.
    expect(onData).toHaveBeenCalledTimes(1);
  });

  it('delivers cached data exactly once under StrictMode double-invoke', async () => {
    const { provider } = makeSharedProvider();
    await warm(provider, KEY_A, DATA_A);

    const onData = vi.fn();
    renderHook(() => useClientDataSWRWithSync<any>(KEY_A, neverFetch, { onData }), {
      wrapper: wrapper(provider, true),
    });

    await waitFor(() => expect(onData).toHaveBeenCalled());
    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledWith(DATA_A);
  });

  it('is safe to sync into a real zustand store (no update-in-render warning)', async () => {
    const { provider } = makeSharedProvider();
    await warm(provider, KEY_A, DATA_A);

    // A real external store consumed via useSyncExternalStore, exactly like the
    // conversation store: onData flips a store flag, a subscriber re-reads it.
    const store = createStore<{ init: boolean; setInit: (v: boolean) => void }>((set) => ({
      init: false,
      setInit: (v) => set({ init: v }),
    }));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const useHarness = () => {
      const init = useStore(store, (s) => s.init);
      useClientDataSWRWithSync<any>(KEY_A, neverFetch, {
        onData: () => store.getState().setInit(true),
      });
      return init;
    };

    const { result } = renderHook(useHarness, { wrapper: wrapper(provider, true) });

    await waitFor(() => expect(result.current).toBe(true));

    const updateInRenderWarning = errorSpy.mock.calls.find((args) =>
      String(args[0]).includes('Cannot update a component'),
    );
    expect(updateInRenderWarning).toBeUndefined();
  });
});
