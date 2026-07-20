/**
 * @vitest-environment happy-dom
 *
 * Deterministic reproduction + fix for the cold-open skeleton bug.
 *
 * On a cold boot the IndexedDB tier hydrates asynchronously. If a consumer
 * registers its SWR key BEFORE that async hydration inserts the row into the
 * provider Map, SWR records a cache miss — and because SWR does not observe a
 * later *direct* Map mutation, the consumer stays empty until its own network
 * revalidation resolves, ignoring the data already sitting on disk / in the Map.
 * (Verified live: the message-list row is in the provider Map seconds before the
 * conversation reads it, yet the conversation waits for the network.)
 *
 * The fix is to re-notify SWR of each hydrated key via `mutate(key, cachedData,
 * { revalidate: false })` once hydration lands, so the already-registered
 * consumer surfaces the cache without a network round-trip.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import useSWR, { type Cache, SWRConfig, unstable_serialize, useSWRConfig } from 'swr';
import { afterEach, describe, expect, it } from 'vitest';

import { localDataCache } from './localDataCache';
import { createCacheProvider, type ScopedSWRProvider } from './localStorageProvider';

const SCOPE = 'race-user:personal';
const KEY = ['MSGS', 'topic-cold'];
const CACHED = [{ id: 'm1', text: 'cached on disk' }];
const FRESH = [{ id: 'm1', text: 'from network' }];

const makeProvider = () =>
  createCacheProvider({
    debounceMs: 5,
    getScope: () => SCOPE,
    idbPatterns: ['MSGS'],
    localPatterns: [],
  });

const wrapper =
  (provider: ScopedSWRProvider) =>
  ({ children }: PropsWithChildren) =>
    createElement(
      SWRConfig,
      { value: { provider: provider as unknown as (c: Readonly<Cache>) => Cache } },
      children,
    );

/** Seed IndexedDB with a persisted SWR state row, as a prior session would leave it. */
const seedDisk = async () => {
  const p = makeProvider();
  const r = renderHook(() => useSWR(KEY, () => Promise.resolve(CACHED)), { wrapper: wrapper(p) });
  await waitFor(() => expect(r.result.current.data).toEqual(CACHED));
  await waitFor(async () => {
    const rows = await localDataCache.entriesByScope(SCOPE);
    expect(rows.length).toBeGreaterThan(0);
  });
  r.unmount();
};

describe('cold-open hydration race (SWR + tiered provider + IndexedDB)', () => {
  afterEach(async () => {
    await localDataCache.clearScope(SCOPE);
  });

  it('control: hydration completes BEFORE mount → cached row is served locally', async () => {
    await seedDisk();
    const p = makeProvider();
    await p.hydrateScope?.();

    let resolveNet!: (v: unknown) => void;
    const slow = new Promise((r) => {
      resolveNet = r;
    });
    const r = renderHook(() => useSWR(KEY, () => slow), { wrapper: wrapper(p) });
    expect(r.result.current.data).toEqual(CACHED);
    resolveNet(FRESH);
  });

  it('BUG: consumer mounts BEFORE hydration → never sees the cached row until the network resolves', async () => {
    await seedDisk();
    const p = makeProvider();

    let resolveNet!: (v: unknown) => void;
    const slow = new Promise((r) => {
      resolveNet = r;
    });
    const r = renderHook(() => useSWR(KEY, () => slow), { wrapper: wrapper(p) });
    expect(r.result.current.data).toBeUndefined();

    await act(async () => {
      await p.hydrateScope?.();
    });
    const mapEntry = [...(p() as Map<string, { data?: unknown }>).values()].find(
      (v) => JSON.stringify((v as { data?: unknown })?.data) === JSON.stringify(CACHED),
    );
    expect(mapEntry).toBeDefined(); // cached row IS in the Map now
    expect(r.result.current.data).toBeUndefined(); // …yet the consumer is still empty

    resolveNet(FRESH);
    await waitFor(() => expect(r.result.current.data).toEqual(FRESH));
  });

  it('FINDING: mutate CANNOT recover an orphaned consumer — so the fix must be mount-after-hydrate', async () => {
    // Why the naive "re-notify after hydration" fix (mutate) does not work, and
    // why the only reliable fix is to guarantee consumers mount after hydration.
    await seedDisk();
    const p = makeProvider();

    const r = renderHook(
      () => {
        const cfg = useSWRConfig();
        const swr = useSWR(KEY, null); // no fetcher — pure cache read, no pending-fetch confound
        return {
          data: swr.data,
          boundMutate: swr.mutate,
          globalMutate: cfg.mutate,
          cache: cfg.cache,
        };
      },
      { wrapper: wrapper(p) },
    );
    expect(r.result.current.data).toBeUndefined(); // subscribed while Map empty → miss

    await act(async () => {
      await p.hydrateScope?.();
    });

    // SWR's cache Map now holds the row WITH its data — hydration worked…
    const cached = r.result.current.cache.get(unstable_serialize(KEY)) as { data?: unknown };
    expect(cached?.data).toEqual(CACHED);

    // …but neither global nor key-bound mutate re-links the orphaned hook: the
    // direct `map.set` during hydration replaced SWR's own state object, and the
    // subscription can't be revived from outside. The consumer stays empty.
    await act(async () => {
      await r.result.current.globalMutate(KEY, CACHED, { revalidate: false });
    });
    expect(r.result.current.data).toBeUndefined();

    await act(async () => {
      await r.result.current.boundMutate(CACHED, { revalidate: false });
    });
    expect(r.result.current.data).toBeUndefined();
  });
});
