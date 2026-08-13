/**
 * @vitest-environment happy-dom
 *
 * Integration: the legacy SWR cache gate and the Projection scope/view gates.
 *
 * CacheHydrationGate guarantees mount-after-hydrate for legacy IndexedDB SWR
 * entries. ProjectionHydrationGate now prepares trusted scope partitions only;
 * each Projection consumer declares and hydrates its own bounded View Contract.
 * The pure-unit repro
 * (`libs/swr/coldHydrationRace.test.tsx`) shows a consumer that subscribes
 * before hydration is permanently orphaned — so if the gate paints early, the
 * cold-open skeleton returns. This exercises that end to end.
 */
import type * as LobeConst from '@lobechat/const';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement, useEffect } from 'react';
import useSWR, { type Cache, SWRConfig, unstable_serialize } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheHydration } from '@/libs/swr/cacheHydration';
import { localDataCache } from '@/libs/swr/localDataCache';
import { createCacheProvider, type ScopedSWRProvider } from '@/libs/swr/localStorageProvider';
import { selectAgentProjectionById } from '@/projection/modules/agent/selectors';
import { homeDailyBriefViewContract } from '@/projection/modules/home/contracts';
import { selectHomeDailyBrief } from '@/projection/modules/home/selectors';
import { projectionRepository } from '@/projection/registry';
import { getProjectionStoreState, useProjectionStore } from '@/projection/store';
import { useProjectionViewHydration } from '@/projection/views/hook';
import { setAppPainted, setAppReady } from '@/spa/atoms/app';
import { useUserStore } from '@/store/user';

import AppBootstrapGate, { isAppBootstrapReady } from './AppBootstrapGate';
import CacheHydrationGate from './CacheHydrationGate';
import ProjectionHydrationGate from './ProjectionHydrationGate';

let mockScope = 'anon:personal';
vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal<typeof LobeConst>();
  return { ...actual, isDesktop: false };
});
vi.mock('@/libs/swr/useCacheScope', () => ({
  buildCacheScope: (userId?: string, workspaceId?: string) =>
    `${userId || 'anon'}:${workspaceId || 'personal'}`,
  getCacheScope: () => mockScope,
  isAnonymousScope: (scope: string) => scope.startsWith('anon:'),
  isScopeTrusted: () => true,
  useCacheScope: () => mockScope,
}));
vi.mock('@/libs/bootTiming', () => ({
  bootTiming: {
    mark: vi.fn(),
    recordSpan: vi.fn(),
    span: vi.fn(async (_name: string, fn: () => unknown) => fn()),
    spanSync: vi.fn((_name: string, fn: () => unknown) => fn()),
  },
}));

const SCOPE = 'u1:personal';
const ACCOUNT_SCOPE = 'u1:account';
const SECOND_SCOPE = 'u2:personal';
const SECOND_ACCOUNT_SCOPE = 'u2:account';
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

let projectionProbed: unknown;
const ProjectionProbe = () => {
  const userId = useUserStore((state) => state.user?.id);
  const accountScope = userId ? `${userId}:account` : mockScope;
  useProjectionViewHydration(homeDailyBriefViewContract, {}, Boolean(userId), accountScope);
  projectionProbed = useProjectionStore((state) =>
    selectHomeDailyBrief(state.scopes[accountScope]),
  );
  useEffect(
    () => () => {
      projectionProbed = undefined;
    },
    [],
  );
  return null;
};

let projectedAgentTitles: Array<string | null | undefined> = [];
const AgentProjectionProbe = () => {
  const title = useProjectionStore(
    (state) => selectAgentProjectionById(state.scopes[mockScope], 'agent-1')?.title,
  );
  projectedAgentTitles.push(title);
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
    projectionProbed = undefined;
    projectedAgentTitles = [];
    useProjectionStore.setState({ scopes: {} });
    useUserStore.setState({
      isLoaded: false,
      isSignedIn: false,
      isUserStateInit: false,
      user: undefined,
    });
    cacheHydration.markPending(SCOPE);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    document.getElementById('loading-screen')?.remove();
    setAppReady(false);
    setAppPainted(false);
    cacheHydration.markPending(SCOPE);
    useUserStore.setState({
      isLoaded: false,
      isSignedIn: false,
      isUserStateInit: false,
      user: undefined,
    });
    useProjectionStore.setState({ scopes: {} });
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

  it('keeps private consumers unmounted until auth settles, then serves hydrated cache on their first render', async () => {
    await seedDisk();
    const provider = makeProvider();

    // The static HTML shell ships `#loading-screen`; CacheHydrationGate's
    // removal backstop only fires once `appReady` is set.
    const loadingScreen = document.createElement('div');
    loadingScreen.id = 'loading-screen';
    document.body.append(loadingScreen);
    setAppReady(true);

    render(
      createElement(
        SWRConfig,
        { value: { provider: asProvider(provider) } },
        createElement(
          AppBootstrapGate,
          null,
          createElement(CacheHydrationGate, null, createElement(Probe)),
        ),
      ),
    );

    await waitFor(() => expect(cacheHydration.isReady(SCOPE)).toBe(true));
    expect(probed).toBeUndefined();
    expect(document.getElementById('loading-screen')).not.toBeNull();

    act(() => {
      useUserStore.setState({ isLoaded: true, isSignedIn: true });
    });

    await waitFor(() => expect(probed).toEqual(CACHED));
    expect(document.getElementById('loading-screen')).toBeNull();

    // The identity gate is a one-way latch: a focus-triggered session refresh
    // must not blank an app that has already rendered.
    act(() => {
      useUserStore.setState({ isLoaded: false });
    });
    expect(probed).toEqual(CACHED);
  });

  it('hydrates only the private consumer View Contract after trusted scopes are prepared', async () => {
    const snapshot = {
      data: { pairs: [{ hint: 'Cached hint', welcome: 'Cached welcome' }] },
      key: 'home.dailyBrief' as const,
      observedAt: Date.now(),
      source: 'network' as const,
    };
    const hydrate = vi.spyOn(projectionRepository, 'hydrate').mockImplementation(async (scope) => ({
      records: [],
      indexes: [],
      snapshots: scope === ACCOUNT_SCOPE ? [snapshot] : [],
    }));

    render(
      createElement(
        SWRConfig,
        { value: { provider: asProvider(() => new Map()) } },
        createElement(
          AppBootstrapGate,
          null,
          createElement(ProjectionHydrationGate, null, createElement(ProjectionProbe)),
        ),
      ),
    );

    expect(hydrate).not.toHaveBeenCalled();
    expect(projectionProbed).toBeUndefined();

    act(() => {
      useUserStore.setState({ isLoaded: true, isSignedIn: true, user: { id: 'u1' } as never });
    });

    await waitFor(() => expect(projectionProbed).toEqual(snapshot.data));
    expect(hydrate).toHaveBeenCalledWith(ACCOUNT_SCOPE, {
      indexes: undefined,
      records: undefined,
      snapshots: ['home.dailyBrief'],
    });
    expect(hydrate).not.toHaveBeenCalledWith(SCOPE, expect.anything());
  });

  it('never exposes the previous account snapshot while a new account scope hydrates', async () => {
    const firstSnapshot = {
      data: { pairs: [{ hint: 'User one hint', welcome: 'User one welcome' }] },
      key: 'home.dailyBrief' as const,
      observedAt: Date.now(),
      source: 'network' as const,
    };
    const secondSnapshot = {
      data: { pairs: [{ hint: 'User two hint', welcome: 'User two welcome' }] },
      key: 'home.dailyBrief' as const,
      observedAt: Date.now() + 1,
      source: 'network' as const,
    };
    let releaseSecondAccount!: () => void;
    const secondAccountReady = new Promise<void>((resolve) => {
      releaseSecondAccount = resolve;
    });
    const hydrate = vi.spyOn(projectionRepository, 'hydrate').mockImplementation(async (scope) => {
      if (scope === SECOND_ACCOUNT_SCOPE) await secondAccountReady;
      return {
        records: [],
        indexes: [],
        snapshots:
          scope === ACCOUNT_SCOPE
            ? [firstSnapshot]
            : scope === SECOND_ACCOUNT_SCOPE
              ? [secondSnapshot]
              : [],
      };
    });

    act(() => {
      useUserStore.setState({ isLoaded: true, isSignedIn: true, user: { id: 'u1' } as never });
    });
    render(
      createElement(
        SWRConfig,
        { value: { provider: asProvider(() => new Map()) } },
        createElement(
          AppBootstrapGate,
          null,
          createElement(
            ProjectionHydrationGate,
            null,
            createElement(ProjectionProbe),
            createElement(AgentProjectionProbe),
          ),
        ),
      ),
    );
    await waitFor(() => expect(projectionProbed).toEqual(firstSnapshot.data));
    act(() => {
      getProjectionStoreState().commitAgentConfig(
        SCOPE,
        { id: 'agent-1', title: 'User one agent' },
        'full',
        'mutation',
      );
    });
    expect(projectedAgentTitles.at(-1)).toBe('User one agent');
    projectedAgentTitles = [];

    act(() => {
      mockScope = SECOND_SCOPE;
      useUserStore.setState({ user: { id: 'u2' } as never });
    });

    expect(projectionProbed).toBeUndefined();
    expect(projectedAgentTitles).not.toContain('User one agent');
    expect(hydrate).not.toHaveBeenCalledWith(SECOND_SCOPE, expect.anything());
    expect(hydrate).toHaveBeenCalledWith(SECOND_ACCOUNT_SCOPE, {
      indexes: undefined,
      records: undefined,
      snapshots: ['home.dailyBrief'],
    });

    releaseSecondAccount();
    await waitFor(() => expect(projectionProbed).toEqual(secondSnapshot.data));
    expect(projectedAgentTitles).not.toContain('User one agent');
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

describe('isAppBootstrapReady', () => {
  it('waits for Better Auth on web', () => {
    expect(
      isAppBootstrapReady({
        authLoaded: false,
        desktop: false,
        desktopOnboarding: false,
        userStateInitialized: false,
      }),
    ).toBe(false);
    expect(
      isAppBootstrapReady({
        authLoaded: true,
        desktop: false,
        desktopOnboarding: false,
        userStateInitialized: false,
      }),
    ).toBe(true);
  });

  it('waits for the desktop user state while preserving desktop onboarding', () => {
    expect(
      isAppBootstrapReady({
        authLoaded: true,
        desktop: true,
        desktopOnboarding: false,
        userStateInitialized: false,
      }),
    ).toBe(false);
    expect(
      isAppBootstrapReady({
        authLoaded: true,
        desktop: true,
        desktopOnboarding: false,
        userStateInitialized: true,
      }),
    ).toBe(true);
    expect(
      isAppBootstrapReady({
        authLoaded: true,
        desktop: true,
        desktopOnboarding: true,
        userStateInitialized: false,
      }),
    ).toBe(true);
  });
});
