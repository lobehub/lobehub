/**
 * @vitest-environment happy-dom
 *
 * Integration: CacheHydrationGate + the real tiered provider + a consumer.
 *
 * The gate's whole job is to guarantee mount-after-hydrate: block first paint
 * until the active scope's IndexedDB cache has hydrated, so every consumer
 * mounted under it reads a populated Map. The pure-unit repro
 * (`libs/swr/coldHydrationRace.test.tsx`) shows a consumer that subscribes
 * before hydration is permanently orphaned — so if the gate paints early, the
 * cold-open skeleton returns. This exercises that end to end.
 */
import { act, render, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import useSWR, { type Cache, SWRConfig, unstable_serialize } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheHydration } from '@/libs/swr/cacheHydration';
import { localDataCache } from '@/libs/swr/localDataCache';
import { createCacheProvider, type ScopedSWRProvider } from '@/libs/swr/localStorageProvider';

import CacheHydrationGate from './CacheHydrationGate';

let mockScope = 'anon:personal';
vi.mock('@/libs/swr/useCacheScope', () => ({ useCacheScope: () => mockScope }));
vi.mock('@/libs/bootTiming', () => ({ bootTiming: { mark: vi.fn(), recordSpan: vi.fn() } }));

const SCOPE = 'u1:personal';
const KEY = ['MSGS', 'topic-cold'];
const CACHED = [{ id: 'm1', text: 'cached on disk' }];
const never = () => new Promise<never>(() => {}); // never resolves — only cache can serve

// A top-level probe so we can observe what an under-gate consumer reads.
let probed: unknown;
const Probe = () => {
  const { data } = useSWR(KEY, never);
  probed = data;
  return null;
};

const asProvider = (p: unknown) => p as unknown as (c: Readonly<Cache>) => Cache;
const wrap =
  (provider: unknown) =>
  ({ children }: { children: ReactNode }) =>
    createElement(SWRConfig, { value: { provider: asProvider(provider) } }, children);

const makeProvider = (): ScopedSWRProvider =>
  createCacheProvider({
    debounceMs: 5,
    getScope: () => SCOPE,
    idbPatterns: ['MSGS'],
    localPatterns: [],
    onScopeHydrated: cacheHydration.markReady,
  });

const seedDisk = async () => {
  const p = makeProvider();
  const r = renderHook(() => useSWR(KEY, () => Promise.resolve(CACHED)), { wrapper: wrap(p) });
  await waitFor(() => expect(r.result.current.data).toEqual(CACHED));
  await waitFor(async () =>
    expect((await localDataCache.entriesByScope(SCOPE)).length).toBeGreaterThan(0),
  );
  r.unmount();
  cacheHydration.markPending(SCOPE);
};

describe('CacheHydrationGate + provider + consumer', () => {
  beforeEach(() => {
    mockScope = SCOPE;
    probed = undefined;
    cacheHydration.markPending(SCOPE);
    const el = document.createElement('div');
    el.id = 'loading-screen';
    document.body.appendChild(el);
  });
  afterEach(async () => {
    document.getElementById('loading-screen')?.remove();
    cacheHydration.markPending(SCOPE);
    await localDataCache.clearScope(SCOPE);
  });

  it('a consumer under the gate reads the cache on first paint (no network)', async () => {
    await seedDisk();
    const provider = makeProvider();

    render(
      createElement(
        SWRConfig,
        { value: { provider: asProvider(provider) } },
        createElement(CacheHydrationGate, null, createElement(Probe)),
      ),
    );

    // The gate blocks the consumer until hydration completes; once it releases,
    // the consumer must already see the cached data — never undefined-then-network.
    await waitFor(() => expect(probed).toEqual(CACHED));
  });

  it('DECISIVE: an early orphaned subscriber does NOT poison the key for a later one', async () => {
    await seedDisk();
    const provider = makeProvider();

    // an EARLY consumer subscribes before hydration → miss (orphaned)
    const early = renderHook(() => useSWR(KEY, never), { wrapper: wrap(provider) });
    expect(early.result.current.data).toBeUndefined();

    await act(async () => {
      await provider.hydrateScope?.();
    });
    expect(early.result.current.data).toBeUndefined(); // early one stays orphaned

    // a LATER consumer subscribes AFTER hydration and reads the populated Map — it
    // HITS. So the gate (which makes the real consumer a "late" subscriber by
    // blocking it until `ready`) is sufficient on its own; the fix is to guarantee
    // the gate releases strictly AFTER hydration.
    const late = renderHook(() => useSWR(KEY, never), { wrapper: wrap(provider) });
    expect(late.result.current.data).toEqual(CACHED);
  });

  it('BUG→FIX: slow hydration must NOT early-release the gate (else the consumer is orphaned)', () => {
    vi.useFakeTimers();
    try {
      // A plain Map provider whose hydration timing we drive by hand, to model a
      // heavy account whose IndexedDB hydration outruns the gate's timeout.
      const map = new Map<string, unknown>();

      render(
        createElement(
          SWRConfig,
          { value: { provider: asProvider(() => map) } },
          createElement(CacheHydrationGate, null, createElement(Probe)),
        ),
      );

      // Hydration is still in flight well past the old 1500ms window. The gate
      // must keep blocking — the consumer must not have subscribed yet (subscribing
      // now, against an empty Map, orphans it forever).
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(probed).toBeUndefined();

      // Hydration finishes: the row lands in the Map AND the scope is marked ready.
      act(() => {
        map.set(unstable_serialize(KEY), { data: CACHED });
        cacheHydration.markReady(SCOPE);
      });

      // Gate releases → the consumer mounts AFTER hydration → reads the populated
      // Map. On the buggy 1500ms gate it mounted empty at 1500ms and is orphaned,
      // so this stays undefined.
      expect(probed).toEqual(CACHED);
    } finally {
      vi.useRealTimers();
    }
  });

  // The local→remote handoff that cache-first relies on — the consumer shows the
  // cached list, then SWR's revalidation replaces it with the fresh server data —
  // is standard stale-while-revalidate and is already proven end to end by
  // `libs/swr/cacheProvider.integration.test.tsx` ("persists fetched data … and
  // serves it locally on reload", then the fresh server value flows through). The
  // gate fix only changes release *timing*, not the revalidation/onData path, so
  // that reconciliation is unchanged from a warm navigation.
});
