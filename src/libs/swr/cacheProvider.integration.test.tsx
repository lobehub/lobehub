/**
 * @vitest-environment happy-dom
 *
 * End-to-end test of the local-first chain through real SWR:
 *   fetch → provider write-through to IndexedDB → "reload" (fresh provider) →
 *   synchronous local-first read before the network resolves.
 */
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import useSWR, { type Cache, SWRConfig } from 'swr';
import { afterEach, describe, expect, it } from 'vitest';

import { localDataCache } from './localDataCache';
import { createCacheProvider } from './localStorageProvider';

const SCOPE = 'integration-scope';

const makeProvider = () => {
  let resolveHydrated: () => void;
  const hydrated = new Promise<void>((r) => {
    resolveHydrated = r;
  });
  const provider = createCacheProvider({
    debounceMs: 5,
    getScope: () => SCOPE,
    idbPatterns: ['MSGS'],
    localPatterns: [],
    onScopeHydrated: () => resolveHydrated(),
  });
  return { hydrated, provider };
};

const wrapper =
  (provider: ReturnType<typeof createCacheProvider>) =>
  ({ children }: PropsWithChildren) =>
    createElement(
      SWRConfig,
      { value: { provider: provider as unknown as (c: Readonly<Cache>) => Cache } },
      children,
    );

describe('local-first cache chain (SWR + tiered provider + IndexedDB)', () => {
  afterEach(async () => {
    await localDataCache.clearScope(SCOPE);
  });

  it('persists fetched data to IndexedDB and serves it locally on reload', async () => {
    const key = ['MSGS', 'topic-1'];
    const serverV1 = [{ id: 'm1', text: 'first load' }];

    // --- session 1: fetch, which the provider writes through to IndexedDB ---
    const { provider: p1 } = makeProvider();
    const fetcher1 = () => Promise.resolve(serverV1);
    const r1 = renderHook(() => useSWR(key, fetcher1), { wrapper: wrapper(p1) });

    await waitFor(() => expect(r1.result.current.data).toEqual(serverV1));
    // write-through to the IndexedDB tier (debounced)
    await waitFor(async () => {
      const rows = await localDataCache.entriesByScope(SCOPE);
      expect(rows.length).toBeGreaterThan(0);
    });
    r1.unmount();

    // --- session 2 ("reload"): fresh provider hydrates IndexedDB ------------
    // Model SPA bootstrap: hydrate the app-level provider before the consuming
    // React tree mounts. SWR then receives the already-hydrated provider Map.
    const { provider: p2 } = makeProvider();
    await p2.hydrateScope?.();

    // a slow network so the local snapshot must win the first paint
    let resolveSlow: (v: unknown) => void;
    const slow = new Promise((r) => {
      resolveSlow = r;
    });
    const fetcher2 = () => slow;
    const r2 = renderHook(() => useSWR(key, fetcher2), { wrapper: wrapper(p2) });

    // local-first: data is available synchronously from the hydrated cache,
    // before the slow fetch resolves
    expect(r2.result.current.data).toEqual(serverV1);

    // then the fresh server value still flows through
    const serverV2 = [{ id: 'm1', text: 'revalidated' }];
    resolveSlow!(serverV2);
    await waitFor(() => expect(r2.result.current.data).toEqual(serverV2));
  });
});
