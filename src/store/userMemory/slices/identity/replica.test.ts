/**
 * @vitest-environment happy-dom
 *
 * The identities list is a `@lobechat/replica` paged resource whose view is the
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

import { identityInitialState } from './initialState';
import { IDENTITY_LIST_KEY, identityListResource, type IdentityListView } from './projection';

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

  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
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
      { queryKey: STORAGE_KEY, scope },
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
      { queryKey: STORAGE_KEY, scope },
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
    const stored = await identityListResource.storage!.get({ queryKey: STORAGE_KEY, scope });
    expect((stored?.data as IdentityListView).items.map((item) => item.id)).toEqual(['i2']);
  });

  it('patches one row in the list view and persists it', async () => {
    vi.spyOn(userMemoryService, 'queryIdentities').mockResolvedValue(
      responseOf([identity('i1', { description: 'old' })]),
    );

    renderHook(() => useUserMemoryStore((s) => s.useFetchIdentities)(PARAMS), { wrapper });
    await waitFor(() => expect(listState().identities).toHaveLength(1));

    act(() => {
      listState().patchIdentityInList('i1', { description: 'new' });
    });

    expect(listState().identities[0].description).toBe('new');
    await waitFor(async () => {
      const stored = await identityListResource.storage!.get({ queryKey: STORAGE_KEY, scope });
      expect((stored?.data as IdentityListView).items[0].description).toBe('new');
    });
  });

  it('drops the previous scope’s list on a cache-scope switch', async () => {
    vi.spyOn(userMemoryService, 'queryIdentities').mockResolvedValue(
      responseOf([identity('i1', { title: 'Personal' })]),
    );

    const { rerender } = renderHook(() => useUserMemoryStore((s) => s.useFetchIdentities)(PARAMS), {
      wrapper,
    });
    await waitFor(() => expect(listState().identities).toHaveLength(1));

    // Switch identity: the new scope's list is still in flight.
    useScope(`${scope.split(':')[0]}:ws-1`);
    vi.spyOn(userMemoryService, 'queryIdentities').mockImplementation(pending);
    rerender();

    expect(listState().identities).toEqual([]);
    expect(listState().identitiesInit).toBe(false);
  });

  it('clears the view (and the persisted row) when told to reset', async () => {
    vi.spyOn(userMemoryService, 'queryIdentities').mockResolvedValue(responseOf([identity('i1')]));

    renderHook(() => useUserMemoryStore((s) => s.useFetchIdentities)(PARAMS), { wrapper });
    await waitFor(() => expect(listState().identities).toHaveLength(1));

    act(() => {
      listState().resetIdentities();
    });

    expect(listState().identities).toEqual([]);
    expect(identitySelectors.identitiesTotal(listState())).toBe(0);
    // The removal is queued behind the write queue; wait for it to land.
    await waitFor(async () => {
      await expect(
        identityListResource.storage!.get({ queryKey: STORAGE_KEY, scope }),
      ).resolves.toBeUndefined();
    });
    expect(IDENTITY_LIST_KEY).toBe('all');
  });
});
