/**
 * @vitest-environment happy-dom
 *
 * The OAuth Apps settings page reads its list and each app's page through
 * `local-replica`: reopening paints the persisted copy while the network
 * confirms, a row and its page change together, and a settled "no such app"
 * is reported instead of loading forever.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { broadcastCacheScope, resetCacheScopeBroadcast } from '@/libs/replica/cacheScopeEvents';
import { setScopedMutate } from '@/libs/swr/mutate';
import { oauthAppService } from '@/services/oauthApp';
import { type OAuthAppItem } from '@/types/oauthApp';

import { initialOAuthAppState } from './initialState';
import { oauthAppDetailResource, oauthAppListResource } from './projection';
import { oauthAppSelectors } from './selectors';
import { useOAuthAppStore } from './store';

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};
const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

/** Never-resolving fetch: what the store holds can only have come from storage. */
const pending = () => new Promise<never>(() => {});

const app = (overrides: Partial<OAuthAppItem> = {}): OAuthAppItem => ({
  applicationType: 'web',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  enabled: true,
  hasSecret: true,
  id: 'lca_app_1',
  lastUsedAt: null,
  name: 'Internal Console',
  ...overrides,
});

const state = () => useOAuthAppStore.getState();

describe('oauthApp replicas', () => {
  const scopes = new Set<string>();
  let scope = '';

  beforeEach(() => {
    resetCacheScopeBroadcast();
    scope = `oauth-user-${randomUUID()}:ws-1`;
    scopes.add(scope);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    useOAuthAppStore.setState({ ...initialOAuthAppState });
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].flatMap((value) => [
        oauthAppListResource.storage!.remove({ queryKey: 'all', scope: value }),
        oauthAppDetailResource.storage!.remove({ queryKey: 'lca_app_1', scope: value }),
      ]),
    );
    scopes.clear();
    resetCacheScopeBroadcast();
    vi.restoreAllMocks();
  });

  it('paints the persisted list and page before the network answers', async () => {
    await oauthAppListResource.storage!.set(
      { queryKey: 'all', scope },
      { data: [app()], updatedAt: 1 },
    );
    await oauthAppDetailResource.storage!.set(
      { queryKey: 'lca_app_1', scope },
      { data: app(), updatedAt: 1 },
    );
    vi.spyOn(oauthAppService, 'list').mockImplementation(pending);
    vi.spyOn(oauthAppService, 'getById').mockImplementation(pending);

    renderHook(
      () => {
        state().useFetchAppList();
        state().useFetchAppDetail('lca_app_1');
      },
      { wrapper },
    );

    await waitFor(() => {
      expect(oauthAppSelectors.appList(state())).toEqual([app()]);
      expect(oauthAppSelectors.appById('lca_app_1')(state())?.name).toBe('Internal Console');
    });
  });

  it('applies the server answer over the persisted copy', async () => {
    await oauthAppListResource.storage!.set(
      { queryKey: 'all', scope },
      { data: [app()], updatedAt: 1 },
    );
    const used = new Date('2026-11-02T00:00:00Z');
    vi.spyOn(oauthAppService, 'list').mockResolvedValue([app({ lastUsedAt: used })]);

    renderHook(() => state().useFetchAppList(), { wrapper });

    await waitFor(() => expect(oauthAppSelectors.appList(state())?.[0].lastUsedAt).toEqual(used));
    await waitFor(async () =>
      expect(
        (await oauthAppListResource.storage!.get({ queryKey: 'all', scope }))?.data[0].lastUsedAt,
      ).toEqual(used),
    );
  });

  it('disables a row and its page together and rolls both back on failure', async () => {
    vi.spyOn(oauthAppService, 'list').mockResolvedValue([app()]);
    vi.spyOn(oauthAppService, 'getById').mockResolvedValue(app());
    renderHook(
      () => {
        state().useFetchAppList();
        state().useFetchAppDetail('lca_app_1');
      },
      { wrapper },
    );
    await waitFor(() => expect(oauthAppSelectors.appById('lca_app_1')(state())).toBeDefined());

    let reject!: (error: Error) => void;
    vi.spyOn(oauthAppService, 'setEnabled').mockImplementation(
      () => new Promise((_, r) => (reject = r)),
    );

    let call!: Promise<void>;
    act(() => {
      call = state().setAppEnabled('lca_app_1', false);
    });
    expect(oauthAppSelectors.appList(state())?.[0].enabled).toBe(false);
    expect(oauthAppSelectors.appById('lca_app_1')(state())?.enabled).toBe(false);

    await act(async () => {
      reject(new Error('boom'));
      await call.catch(() => {});
    });
    expect(oauthAppSelectors.appList(state())?.[0].enabled).toBe(true);
    expect(oauthAppSelectors.appById('lca_app_1')(state())?.enabled).toBe(true);
  });

  it('marks an app the server no longer returns as not found', async () => {
    vi.spyOn(oauthAppService, 'getById').mockResolvedValue(undefined);

    renderHook(() => state().useFetchAppDetail('lca_app_1'), { wrapper });

    await waitFor(() => expect(oauthAppSelectors.isAppNotFound('lca_app_1')(state())).toBe(true));
    expect(oauthAppSelectors.appById('lca_app_1')(state())).toBeUndefined();
  });

  it('forgets a settled missing app when the cache scope changes', async () => {
    vi.spyOn(oauthAppService, 'getById').mockResolvedValue(undefined);

    renderHook(() => state().useFetchAppDetail('lca_app_1'), { wrapper });
    await waitFor(() => expect(oauthAppSelectors.isAppNotFound('lca_app_1')(state())).toBe(true));

    const next = `oauth-user-${randomUUID()}:ws-2`;
    scopes.add(next);
    act(() => broadcastCacheScope(next));

    // The owning workspace must not inherit the previous scope's "gone" verdict
    // and bounce the page back before its own answer lands.
    expect(oauthAppSelectors.isAppNotFound('lca_app_1')(state())).toBe(false);
  });
});
