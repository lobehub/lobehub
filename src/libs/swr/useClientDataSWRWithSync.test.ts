/**
 * @vitest-environment happy-dom
 *
 * Regression: a persisted-cache hit for the NEXT key must reach onData.
 *
 * `hasSyncedRef` guards against double-syncing one key's data. It used to be
 * reset in a plain useEffect, which runs AFTER the data-effect in the same
 * commit — so when the key changed and SWR already held cached data for the
 * new key, the data-effect fired first, saw the stale guard, and swallowed
 * the sync. In the goal store this meant switching agents kept rendering the
 * previous agent's list until the network resolved.
 *
 * The discriminating leg (third test) switches the key with the row already
 * in the cache and a fetcher that can never resolve — no network callback can
 * fire, so onData running at all proves the cache-hit effect beat the guard.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { Cache } from 'swr';
import { SWRConfig } from 'swr';
import { describe, expect, it, vi } from 'vitest';

import { useClientDataSWRWithSync } from './useClientDataSWRWithSync';

const makeWrapper =
  (cache: Map<string, unknown>) =>
  ({ children }: { children: ReactNode }) =>
    createElement(SWRConfig, { value: { provider: () => cache as unknown as Cache } }, children);

type Leg = { key: string; fetcher: () => Promise<{ id: string }> };

const never = () => new Promise<{ id: string }>(() => {});

describe('useClientDataSWRWithSync', () => {
  it('calls onData when data arrives, and again for a different key', async () => {
    const seen: string[] = [];

    const { rerender } = renderHook(
      ({ key }: { key: string }) =>
        useClientDataSWRWithSync(key, () => Promise.resolve({ id: key }), {
          onData: (data: { id: string }) => {
            seen.push(data.id);
          },
        }),
      {
        initialProps: { key: 'a' },
        wrapper: makeWrapper(new Map()),
      },
    );

    await waitFor(() => expect(seen).toEqual(['a']));

    // Switch to a key whose fetcher resolves instantly: onData must fire for
    // the new key — a stale guard must not swallow it.
    rerender({ key: 'b' });

    await waitFor(() => expect(seen).toEqual(['a', 'b']));
  });

  it('syncs a cache hit for a new key in the same commit as the switch', async () => {
    const seen: string[] = [];
    const onData = (data: { id: string }) => {
      seen.push(data.id);
    };
    const cache = new Map();
    const wrapper = makeWrapper(cache);

    const { rerender } = renderHook(
      ({ key, fetcher }: Leg) => useClientDataSWRWithSync(key, fetcher, { onData }),
      { initialProps: { key: 'b', fetcher: () => Promise.resolve({ id: 'b' }) }, wrapper },
    );
    await waitFor(() => expect(seen).toEqual(['b']));

    // Switch to key 'a' and let it resolve — the guard is now set by 'a'.
    rerender({ key: 'a', fetcher: () => Promise.resolve({ id: 'a' }) });
    await waitFor(() => expect(seen).toEqual(['b', 'a']));

    // Switch back to 'b': the row is already in the cache, and this leg's
    // fetcher never resolves, so no network callback can deliver 'b'. onData
    // firing proves the cache-hit effect ran — which requires the guard to
    // have been reset before the data-effect, i.e. the useLayoutEffect fix.
    rerender({ key: 'b', fetcher: never });

    await waitFor(() => expect(seen).toEqual(['b', 'a', 'b']), { timeout: 2000 });
  });

  it('serves a persisted-cache hit through onData without any network', async () => {
    const cache = new Map();
    const wrapper = makeWrapper(cache);
    const onData = vi.fn();

    // Warm the cache through a normal hook lifecycle first.
    const warm = renderHook(
      ({ key }: { key: string }) =>
        useClientDataSWRWithSync(key, () => Promise.resolve({ id: key }), { onData }),
      { initialProps: { key: 'warm' }, wrapper },
    );
    await waitFor(() => expect(onData).toHaveBeenCalledWith({ id: 'warm' }));
    warm.unmount();

    // A fresh consumer of the same key with the network unavailable still
    // syncs — this is the revisit path that used to render an empty state.
    const fresh = renderHook(
      () =>
        useClientDataSWRWithSync('warm', never, {
          onData,
          revalidateIfStale: false,
          revalidateOnFocus: false,
          revalidateOnReconnect: false,
        }),
      { wrapper },
    );

    await waitFor(() => expect(onData).toHaveBeenCalledTimes(2));
    expect(fresh.result.current.data).toEqual({ id: 'warm' });
  });

  it('does not call onData twice for the same key', async () => {
    const onData = vi.fn();

    renderHook(
      () => useClientDataSWRWithSync('same', () => Promise.resolve({ id: 'a' }), { onData }),
      { wrapper: makeWrapper(new Map()) },
    );

    await waitFor(() => expect(onData).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(onData).toHaveBeenCalledTimes(1);
  });
});
