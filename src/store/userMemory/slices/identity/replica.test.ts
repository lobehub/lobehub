/**
 * @vitest-environment happy-dom
 *
 * The identities list is a `local-replica` paged resource whose view is the
 * userMemory store's flat `identities` array (with `identitiesMeta` beside it):
 * the persisted head page paints while the network confirms it, "load more"
 * appends through the engine, an optimistic delete rolls back on failure, and a
 * cache-scope switch drops the previous identity's rows before paint.
 */
import { randomUUID } from 'node:crypto';

import type { IdentityListItem } from '@lobechat/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { identitySelectors, useUserMemoryStore } from '@/store/userMemory';

import { identityScopeOf, MAX_RECENT_MEMORY_QUERIES } from '../../utils/replica';
import { identityInitialState } from './initialState';
import { identityListResource, type IdentityListView } from './projection';

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

const identity = (id: string, overrides: Partial<IdentityListItem> = {}): IdentityListItem => ({
  capturedAt: new Date('2026-01-01T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  description: null,
  episodicDate: null,
  id,
  relationship: 'self',
  role: null,
  tags: null,
  title: id,
  type: 'personal',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

/** One `queryIdentities` response (the service envelope, not the replica view). */
const responseOf = (
  items: IdentityListItem[],
  overrides: { page?: number; total?: number } = {},
) => ({
  items,
  page: overrides.page ?? 1,
  pageSize: 12,
  total: overrides.total ?? items.length,
});

const pageOf = (
  items: IdentityListItem[],
  overrides: Partial<IdentityListView> = {},
): IdentityListView => ({
  currentPage: 0,
  hasMore: false,
  items,
  pageSize: 12,
  total: items.length,
  ...overrides,
});

/** Never-resolving fetch: what the store holds can only have come from storage. */
const pending = () => new Promise<never>(() => {});

const PARAMS = { pageSize: 12 };
const STORAGE_KEY = identityListResource.storageKey(PARAMS);

const listState = () => useUserMemoryStore.getState();

describe('identity list replica', () => {
  const scopes = new Set<string>();
  let scope = '';
  /** Storage partition of userMemory replicas: the user, not the workspace. */
  let rowScope = '';

  const useScope = (next: string) => {
    scope = next;
    rowScope = identityScopeOf(scope);
    scopes.add(rowScope);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  beforeEach(() => {
    useScope(`identity-user-${randomUUID()}:personal`);
    useUserMemoryStore.setState({ ...identityInitialState });
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].map((value) =>
        identityListResource.storage!.remove({ queryKey: STORAGE_KEY, scope: value }),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted head page before the network answers', async () => {
    await identityListResource.storage!.set(
      { queryKey: STORAGE_KEY, scope: rowScope },
      { data: pageOf([identity('i1', { title: 'Cached' })]), updatedAt: 1 },
    );
    vi.spyOn(userMemoryService, 'queryIdentities').mockImplementation(pending);

    renderHook(() => useUserMemoryStore((s) => s.useFetchIdentities)(PARAMS), { wrapper });

    await waitFor(() => expect(listState().identitiesInit).toBe(true));
    expect(listState().identities).toHaveLength(1);
    expect(listState().identities[0].title).toBe('Cached');
    // The slot is filled from storage, so the local read is what settled it.
    expect(identitySelectors.identitiesTotal(listState())).toBe(1);
  });

  it('seeds the persisted head page before the route commits', async () => {
    await identityListResource.storage!.set(
      { queryKey: STORAGE_KEY, scope: rowScope },
      { data: pageOf([identity('i1', { title: 'Seeded' })]), updatedAt: 1 },
    );
    vi.spyOn(userMemoryService, 'queryIdentities').mockImplementation(pending);

    await act(async () => {
      await listState().preHydrateIdentities(PARAMS);
    });

    expect(listState().identities.map((item) => item.title)).toEqual(['Seeded']);
    expect(listState().identitiesInit).toBe(true);
  });

  it('appends the next page through the engine and keeps `hasMore` honest', async () => {
    const head = Array.from({ length: 12 }, (_, i) => identity(`i${i}`));
    const next = Array.from({ length: 12 }, (_, i) => identity(`i${i + 12}`));
    const fetchSpy = vi
      .spyOn(userMemoryService, 'queryIdentities')
      .mockResolvedValue(responseOf(head, { total: 24 }));

    const { result } = renderHook(
      () => ({
        loadMore: useUserMemoryStore((s) => s.loadMoreIdentities),
        sync: useUserMemoryStore((s) => s.useFetchIdentities)(PARAMS),
      }),
      { wrapper },
    );

    await waitFor(() => expect(listState().identities).toHaveLength(12));
    expect(identitySelectors.identitiesHasMore(listState())).toBe(true);

    fetchSpy.mockResolvedValue(responseOf(next, { page: 2, total: 24 }));
    await act(async () => {
      await result.current.loadMore();
    });

    expect(listState().identities).toHaveLength(24);
    expect(listState().identities[12].id).toBe('i12');
    expect(identitySelectors.identitiesHasMore(listState())).toBe(false);
    // Offset mode: the cursor is the page index; the server is asked for page 2.
    expect(fetchSpy).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 12 }));
  });

  it('exposes load-more progress and failure so the list can show them and retry', async () => {
    const head = Array.from({ length: 12 }, (_, i) => identity(`i${i}`));
    const fetchSpy = vi
      .spyOn(userMemoryService, 'queryIdentities')
      .mockResolvedValue(responseOf(head, { total: 24 }));

    renderHook(() => useUserMemoryStore((s) => s.useFetchIdentities)(PARAMS), { wrapper });
    await waitFor(() => expect(listState().identities).toHaveLength(12));

    let fail!: (error: Error) => void;
    fetchSpy.mockImplementation(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    let loading!: Promise<void>;
    act(() => {
      loading = listState().loadMoreIdentities();
    });
    await waitFor(() => expect(identitySelectors.identitiesIsLoadingMore(listState())).toBe(true));
    expect(identitySelectors.identitiesLoadMoreError(listState())).toBeUndefined();

    const failure = new Error('offline');
    await act(async () => {
      fail(failure);
      await loading.catch(() => {});
    });

    expect(identitySelectors.identitiesIsLoadingMore(listState())).toBe(false);
    expect(identitySelectors.identitiesLoadMoreError(listState())).toBe(failure);
    // The rows already on screen stay; only the next page is missing.
    expect(listState().identities).toHaveLength(12);
  });

  it('removes a row optimistically and rolls it back when the server rejects', async () => {
    vi.spyOn(userMemoryService, 'queryIdentities').mockResolvedValue(
      responseOf([identity('i1'), identity('i2')]),
    );
    const deleteSpy = vi
      .spyOn(memoryCRUDService, 'deleteIdentity')
      .mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useUserMemoryStore((s) => s.deleteIdentity), { wrapper });
    renderHook(() => useUserMemoryStore((s) => s.useFetchIdentities)(PARAMS), { wrapper });
    await waitFor(() => expect(listState().identities).toHaveLength(2));

    await act(async () => {
      await expect(result.current('i1')).rejects.toThrow('offline');
    });

    expect(deleteSpy).toHaveBeenCalledWith('i1');
    // Rolled back to the confirmed page, nothing lost.
    expect(listState().identities.map((item) => item.id)).toEqual(['i1', 'i2']);
  });

  it('keeps offset paging contiguous after a delete (collapse + fresh head first)', async () => {
    let server = Array.from({ length: 30 }, (_, i) => identity(`r${i}`));
    vi.spyOn(userMemoryService, 'queryIdentities').mockImplementation(
      async ({ page = 1, pageSize = 12 }: { page?: number; pageSize?: number } = {}) =>
        responseOf(server.slice((page - 1) * pageSize, page * pageSize), {
          page,
          total: server.length,
        }),
    );
    vi.spyOn(memoryCRUDService, 'deleteIdentity').mockResolvedValue(undefined);

    renderHook(() => useUserMemoryStore((s) => s.useFetchIdentities)(PARAMS), { wrapper });
    await waitFor(() => expect(listState().identities).toHaveLength(12));
    await act(async () => {
      await listState().loadMoreIdentities();
    });
    await waitFor(() => expect(listState().identities).toHaveLength(24));

    server = server.filter((item) => item.id !== 'r5');
    await act(async () => {
      await listState().deleteIdentity('r5');
    });
    await act(async () => {
      await listState().loadMoreIdentities();
    });

    // Without the collapse, the stale page-2 offset would skip r12.
    await waitFor(() =>
      expect(listState().identities.map((item) => item.id)).toEqual(
        server.slice(0, 24).map((item) => item.id),
      ),
    );
  });

  it('paints a previously persisted search from storage when switching to it offline', async () => {
    const SEARCH = { pageSize: 12, q: 'alice' };
    await identityListResource.storage!.set(
      { queryKey: identityListResource.storageKey(SEARCH), scope: rowScope },
      {
        data: {
          currentPage: 0,
          hasMore: false,
          items: [identity('cached-alice')],
          pageSize: 12,
          q: 'alice',
          total: 1,
        } satisfies IdentityListView,
        updatedAt: 1,
      },
    );
    scopes.add(rowScope);
    const fetchSpy = vi
      .spyOn(userMemoryService, 'queryIdentities')
      .mockResolvedValueOnce(responseOf([identity('i1')]));

    const hook = renderHook(
      (params: typeof PARAMS & { q?: string }) =>
        useUserMemoryStore((s) => s.useFetchIdentities)(params),
      { initialProps: PARAMS as typeof PARAMS & { q?: string }, wrapper },
    );
    await waitFor(() => expect(listState().identities.map((item) => item.id)).toEqual(['i1']));

    // Offline: the search never answers, only its persisted row can paint it.
    fetchSpy.mockRejectedValue(new Error('offline'));
    hook.rerender(SEARCH);

    await waitFor(() =>
      expect(listState().identities.map((item) => item.id)).toEqual(['cached-alice']),
    );
    expect(listState().identitiesMeta).toMatchObject({ q: 'alice' });
    await identityListResource.storage!.remove({
      queryKey: identityListResource.storageKey(SEARCH),
      scope: rowScope,
    });
  });

  it('bounds how many identity search variants are kept', async () => {
    vi.spyOn(userMemoryService, 'queryIdentities').mockImplementation(async ({ q } = {}) =>
      responseOf([identity(`${q}-hit`)]),
    );
    const queries = Array.from({ length: MAX_RECENT_MEMORY_QUERIES + 2 }, (_, i) => `q-${i}`);
    const keyOf = (q: string) => identityListResource.storageKey({ ...PARAMS, q });

    const hook = renderHook(
      (props: { q: string }) =>
        useUserMemoryStore((s) => s.useFetchIdentities)({ ...PARAMS, q: props.q }),
      { initialProps: { q: queries[0] }, wrapper },
    );
    for (const q of queries) {
      hook.rerender({ q });
      await waitFor(() => expect(listState().identityListEntries[keyOf(q)]).toBeDefined());
    }

    expect(Object.keys(listState().identityListEntries)).toHaveLength(MAX_RECENT_MEMORY_QUERIES);
    // The oldest searches left memory and IndexedDB together.
    await waitFor(async () =>
      expect(
        await identityListResource.storage!.get({ queryKey: keyOf(queries[0]), scope: rowScope }),
      ).toBeUndefined(),
    );
    for (const q of queries) {
      await identityListResource.storage!.remove({ queryKey: keyOf(q), scope: rowScope });
    }
  });

  it('removes a deleted row from the view and the persisted copy', async () => {
    const fetchSpy = vi
      .spyOn(userMemoryService, 'queryIdentities')
      .mockResolvedValue(responseOf([identity('i1'), identity('i2')]));
    vi.spyOn(memoryCRUDService, 'deleteIdentity').mockResolvedValue(undefined);

    renderHook(() => useUserMemoryStore((s) => s.useFetchIdentities)(PARAMS), { wrapper });
    await waitFor(() => expect(listState().identities).toHaveLength(2));

    fetchSpy.mockResolvedValue(responseOf([identity('i2')]));
    await act(async () => {
      await listState().deleteIdentity('i1');
    });

    await waitFor(() => expect(listState().identities.map((item) => item.id)).toEqual(['i2']));
    const stored = await identityListResource.storage!.get({
      queryKey: STORAGE_KEY,
      scope: rowScope,
    });
    expect((stored?.data as IdentityListView).items.map((item) => item.id)).toEqual(['i2']);
  });

  it('removes a deleted identity from every persisted query, not only the one on screen', async () => {
    const FILTERED = { ...PARAMS, q: 'mentor' };
    const fetchSpy = vi
      .spyOn(userMemoryService, 'queryIdentities')
      .mockResolvedValue(responseOf([identity('i1'), identity('i2')]));
    vi.spyOn(memoryCRUDService, 'deleteIdentity').mockResolvedValue(undefined);

    // Visit the unfiltered list (persisted), then search: the user deletes from
    // the search, so the unfiltered variant is no longer the loaded one.
    const { rerender } = renderHook(
      ({ params }) => useUserMemoryStore((s) => s.useFetchIdentities)(params),
      { initialProps: { params: PARAMS as typeof FILTERED | typeof PARAMS }, wrapper },
    );
    await waitFor(async () => {
      const stored = await identityListResource.storage!.get({
        queryKey: STORAGE_KEY,
        scope: rowScope,
      });
      expect((stored?.data as IdentityListView | undefined)?.items).toHaveLength(2);
    });
    fetchSpy.mockResolvedValue(responseOf([identity('i1')]));
    rerender({ params: FILTERED });
    await waitFor(() => expect(listState().identities.map((item) => item.id)).toEqual(['i1']));

    fetchSpy.mockResolvedValue(responseOf([]));
    await act(async () => {
      await listState().deleteIdentity('i1');
    });

    expect(listState().identities).toEqual([]);
    await waitFor(async () => {
      const stored = await identityListResource.storage!.get({
        queryKey: STORAGE_KEY,
        scope: rowScope,
      });
      expect((stored?.data as IdentityListView).items.map((item) => item.id)).toEqual(['i2']);
    });
  });

  it('patches one row in the list view and persists it', async () => {
    vi.spyOn(userMemoryService, 'queryIdentities').mockResolvedValue(
      responseOf([identity('i1', { description: 'old' })]),
    );

    renderHook(() => useUserMemoryStore((s) => s.useFetchIdentities)(PARAMS), { wrapper });
    await waitFor(() => expect(listState().identities).toHaveLength(1));

    act(() => {
      listState().internal_updateIdentityEntity('i1', (item) => ({ ...item, description: 'new' }));
    });

    expect(listState().identities[0].description).toBe('new');
    await waitFor(async () => {
      const stored = await identityListResource.storage!.get({
        queryKey: STORAGE_KEY,
        scope: rowScope,
      });
      expect((stored?.data as IdentityListView).items[0].description).toBe('new');
    });
  });

  it('drops the previous user’s list on an account switch', async () => {
    vi.spyOn(userMemoryService, 'queryIdentities').mockResolvedValue(
      responseOf([identity('i1', { title: 'Personal' })]),
    );

    const { rerender } = renderHook(() => useUserMemoryStore((s) => s.useFetchIdentities)(PARAMS), {
      wrapper,
    });
    await waitFor(() => expect(listState().identities).toHaveLength(1));

    // Switch account: the new user's list is still in flight.
    useScope(`identity-user-${randomUUID()}:personal`);
    vi.spyOn(userMemoryService, 'queryIdentities').mockImplementation(pending);
    rerender();

    expect(listState().identities).toEqual([]);
    expect(listState().identitiesInit).toBe(false);
  });

  it('keeps the user’s list across a workspace switch (memories are per user)', async () => {
    vi.spyOn(userMemoryService, 'queryIdentities').mockResolvedValue(
      responseOf([identity('i1', { title: 'Personal' })]),
    );

    const { rerender } = renderHook(() => useUserMemoryStore((s) => s.useFetchIdentities)(PARAMS), {
      wrapper,
    });
    await waitFor(() => expect(listState().identities).toHaveLength(1));

    useScope(`${scope.split(':')[0]}:ws-1`);
    vi.spyOn(userMemoryService, 'queryIdentities').mockImplementation(pending);
    rerender();

    expect(listState().identities.map((item) => item.id)).toEqual(['i1']);
    expect(listState().identitiesInit).toBe(true);
  });

  it('clears the view (and the persisted row) when told to reset', async () => {
    const fetchSpy = vi
      .spyOn(userMemoryService, 'queryIdentities')
      .mockResolvedValue(responseOf([identity('i1')]));

    renderHook(() => useUserMemoryStore((s) => s.useFetchIdentities)(PARAMS), { wrapper });
    await waitFor(() => expect(listState().identities).toHaveLength(1));

    // The purge emptied the server; the clear itself is synchronous.
    fetchSpy.mockResolvedValue(responseOf([]));
    let reset!: Promise<boolean>;
    act(() => {
      reset = listState().internal_clearIdentityList();
    });

    expect(listState().identities).toEqual([]);
    expect(identitySelectors.identitiesTotal(listState())).toBe(0);
    await act(async () => {
      await expect(reset).resolves.toBe(true);
    });
    // The deleted row is gone from the persisted copy (at most the refetched empty page remains).
    const stored = await identityListResource.storage!.get({
      queryKey: STORAGE_KEY,
      scope: rowScope,
    });
    expect((stored?.data as IdentityListView | undefined)?.items ?? []).toEqual([]);
  });

  it('clears every persisted query of the list on reset, not only the one on screen', async () => {
    const FILTERED = { ...PARAMS, q: 'mentor' };
    const FILTERED_KEY = identityListResource.storageKey(FILTERED);
    const fetchSpy = vi
      .spyOn(userMemoryService, 'queryIdentities')
      .mockResolvedValue(responseOf([identity('i1')]));

    // Visit the unfiltered list, then switch to a search: two persisted rows.
    const { rerender } = renderHook(
      ({ params }) => useUserMemoryStore((s) => s.useFetchIdentities)(params),
      { initialProps: { params: PARAMS as typeof FILTERED | typeof PARAMS }, wrapper },
    );
    await waitFor(async () => {
      await expect(
        identityListResource.storage!.get({ queryKey: STORAGE_KEY, scope: rowScope }),
      ).resolves.toBeDefined();
    });
    fetchSpy.mockResolvedValue(responseOf([identity('i2')]));
    rerender({ params: FILTERED });
    await waitFor(async () => {
      await expect(
        identityListResource.storage!.get({ queryKey: FILTERED_KEY, scope: rowScope }),
      ).resolves.toBeDefined();
    });

    // The purge deleted everything server-side; the mounted query refetches.
    fetchSpy.mockResolvedValue(responseOf([]));
    await act(async () => {
      await listState().internal_clearIdentityList();
    });

    // The unfiltered projection must not survive to pre-hydrate after a reload.
    await expect(
      identityListResource.storage!.get({ queryKey: STORAGE_KEY, scope: rowScope }),
    ).resolves.toBeUndefined();
    // The query on screen holds at most the server's (empty) answer.
    const filtered = await identityListResource.storage!.get({
      queryKey: FILTERED_KEY,
      scope: rowScope,
    });
    expect((filtered?.data as IdentityListView | undefined)?.items ?? []).toEqual([]);
  });
});
