/**
 * @vitest-environment happy-dom
 *
 * The four offset-paged memory lists (activities, contexts, experiences,
 * preferences) share one implementation (`MemoryQueryList` +
 * `OffsetListPager`). This suite runs the same local-first, query, purge, edit
 * and delete/paging guarantees against each of them through the store, with
 * the real replica engine and IndexedDB-backed storage.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, REPLICA_INDEX_KEY, type ReplicaPagedData } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';
import { LayersEnum } from '@/types/userMemory';

import { initialState } from '../initialState';
import { useUserMemoryStore } from '../store';
import { identityScopeOf, MAX_RECENT_MEMORY_QUERIES, memoryListKey } from '../utils/replica';
import { activityListResource } from './activity/projection';
import { contextListResource } from './context/projection';
import { experienceListResource } from './experience/projection';
import { preferenceListResource } from './preference/projection';

type Row = { id: string; title?: string };
type ListData = ReplicaPagedData<Row, number> & { q?: string; sort?: string };

interface ListCase {
  deleteMethod: 'deleteActivity' | 'deleteContext' | 'deleteExperience' | 'deletePreference';
  /** Fetch method on `userMemoryService`. */
  fetch: 'queryActivities' | 'queryExperiences' | 'queryMemories';
  /** Extra args the fetch is scoped by (the memory layer). */
  fetchArgs?: Record<string, unknown>;
  name: string;
  p: string;
  P: string;
  /** Server row as the endpoint returns it. */
  raw: (id: string) => unknown;
  resource: { storage?: any; storageKey: (params: any) => string };
  /** Store field / action names, `s` singular and `p` plural. */
  s: string;
  S: string;
  sort: string;
}

const flat = (id: string) => ({ id, title: id });

const CASES: ListCase[] = [
  {
    P: 'Activities',
    S: 'Activity',
    deleteMethod: 'deleteActivity',
    fetch: 'queryActivities',
    name: 'activities',
    p: 'activities',
    raw: flat,
    resource: activityListResource,
    s: 'activity',
    sort: 'startsAt',
  },
  {
    P: 'Contexts',
    S: 'Context',
    deleteMethod: 'deleteContext',
    fetch: 'queryMemories',
    fetchArgs: { layer: LayersEnum.Context },
    name: 'contexts',
    p: 'contexts',
    raw: (id) => ({ context: {}, memory: { id, title: id } }),
    resource: contextListResource,
    s: 'context',
    sort: 'scoreImpact',
  },
  {
    P: 'Experiences',
    S: 'Experience',
    deleteMethod: 'deleteExperience',
    fetch: 'queryExperiences',
    name: 'experiences',
    p: 'experiences',
    raw: flat,
    resource: experienceListResource,
    s: 'experience',
    sort: 'scoreConfidence',
  },
  {
    P: 'Preferences',
    S: 'Preference',
    deleteMethod: 'deletePreference',
    fetch: 'queryMemories',
    fetchArgs: { layer: LayersEnum.Preference },
    name: 'preferences',
    p: 'preferences',
    raw: (id) => ({ memory: { id, title: id }, preference: {} }),
    resource: preferenceListResource,
    s: 'preference',
    sort: 'scorePriority',
  },
];

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

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

const page = (items: unknown[], total: number) => ({ items, page: 1, pageSize: 12, total });

describe.each(CASES)('$name list replica', (list) => {
  const scopes = new Set<string>();
  let scope = '';
  /** Storage partition of userMemory replicas: the user, not the workspace. */
  let rowScope = '';
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const queryKeys = new Set<string>();

  const state = () => useUserMemoryStore.getState() as any;
  const view = (): ListData | undefined => state()[`${list.s}ListData`];
  const ids = (data?: ListData) => data?.items.map((row) => row.id);
  const entry = (query: Record<string, unknown>): ListData | undefined =>
    state()[`${list.s}ListEntries`][memoryListKey(query)];
  const storageKey = (query: Record<string, unknown> = {}) => {
    const key = list.resource.storageKey({ pageSize: 12, ...query });
    queryKeys.add(key);
    return key;
  };
  const stored = async (query: Record<string, unknown> = {}) =>
    (await list.resource.storage.get({ queryKey: storageKey(query), scope: rowScope }))?.data as
      ListData | undefined;
  const persist = (query: Record<string, unknown>, data: ListData) =>
    list.resource.storage.set(
      { queryKey: storageKey(query), scope: rowScope },
      { data, updatedAt: 1 },
    );

  const useFetch = (query: Record<string, unknown> = {}) =>
    useUserMemoryStore((s: any) => s[`useFetch${list.P}`])({ pageSize: 12, ...query });
  const loadMore = () => state()[`loadMore${list.P}`]();
  const remove = (id: string) => state()[`delete${list.S}`](id) as Promise<void>;

  /** A paged server: `rows` is read at request time, so a test can mutate it. */
  const serve = (rows: () => string[]) =>
    fetchSpy.mockImplementation(
      async ({ page: pageNo = 1, pageSize = 12 }: { page?: number; pageSize?: number } = {}) => {
        const all = rows();
        const start = (pageNo - 1) * pageSize;
        return page(all.slice(start, start + pageSize).map(list.raw), all.length);
      },
    );
  const rowsOf = (length: number) => Array.from({ length }, (_, i) => `r${i}`);

  const useScope = (next: string) => {
    scope = next;
    rowScope = identityScopeOf(scope);
    scopes.add(rowScope);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  beforeEach(() => {
    useScope(`${list.name}-user-${randomUUID()}:personal`);
    fetchSpy = vi.spyOn(userMemoryService, list.fetch as any);
    act(() => useUserMemoryStore.setState(initialState, false));
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].flatMap((value) => [
        ...[...queryKeys].map((queryKey) =>
          list.resource.storage.remove({ queryKey, scope: value }),
        ),
        list.resource.storage.remove({ queryKey: REPLICA_INDEX_KEY, scope: value }),
      ]),
    );
    scopes.clear();
    queryKeys.clear();
    vi.restoreAllMocks();
  });

  it('keeps one entry per search / sort, independent of the page size', () => {
    expect(memoryListKey({ pageSize: 12 })).toBe(memoryListKey({ q: '' }));
    expect(memoryListKey({ q: 'foo' })).not.toBe(memoryListKey({}));
    expect(memoryListKey({ sort: list.sort })).not.toBe(memoryListKey({}));
  });

  it('paints the persisted head page before the network answers', async () => {
    await persist({}, { currentPage: 0, hasMore: true, items: [flat('cached')], pageSize: 12 });
    fetchSpy.mockImplementation(pending);

    renderHook(() => useFetch(), { wrapper });

    await waitFor(() => expect(ids(view())).toEqual(['cached']));
    expect(state()[list.p].map((row: Row) => row.id)).toEqual(['cached']);
    expect(state()[`${list.p}Init`]).toBe(true);
  });

  it('pre-hydrates the query a route asks for before it mounts', async () => {
    await persist(
      { q: 'foo' },
      { currentPage: 0, hasMore: false, items: [flat('foo-1')], pageSize: 12, q: 'foo' },
    );
    fetchSpy.mockImplementation(pending);

    await expect(state()[`preHydrate${list.P}`]({ q: 'foo' })).resolves.toBe(true);

    expect(ids(entry({ q: 'foo' }))).toEqual(['foo-1']);
    expect(entry({})).toBeUndefined();
  });

  it('replaces the head page with the server response and persists it', async () => {
    serve(() => ['a', 'b']);

    renderHook(() => useFetch(), { wrapper });

    await waitFor(() => expect(ids(view())).toEqual(['a', 'b']));
    expect(state()[`${list.p}Total`]).toBe(2);
    expect(state()[list.p][0]).toMatchObject({ id: 'a', title: 'a' });
    if (list.fetchArgs)
      expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining(list.fetchArgs));
    await waitFor(async () => expect(ids(await stored())).toEqual(['a', 'b']));
  });

  it('appends the next page with the loaded query params', async () => {
    serve(() => rowsOf(24));

    renderHook(() => useFetch({ q: 'foo' }), { wrapper });
    await waitFor(() => expect(view()?.items).toHaveLength(12));

    await act(async () => {
      await loadMore();
    });

    await waitFor(() => expect(view()?.items).toHaveLength(24));
    expect(view()).toMatchObject({ currentPage: 1, hasMore: false });
    expect(fetchSpy).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, q: 'foo' }));
  });

  it('switches queries without dropping a page set, and switches back from memory', async () => {
    serve(() => ['a']);
    const hook = renderHook((query: Record<string, unknown>) => useFetch(query), {
      initialProps: {},
      wrapper,
    });
    await waitFor(() => expect(ids(view())).toEqual(['a']));
    await waitFor(async () => expect(await stored()).toBeDefined());

    fetchSpy.mockImplementation(pending);
    hook.rerender({ sort: list.sort });

    // The new query has no rows yet: the previous query's rows never show under it.
    expect(view()).toBeUndefined();
    expect(state()[list.p]).toEqual([]);
    expect(ids(entry({}))).toEqual(['a']);
    expect(ids(await stored())).toEqual(['a']);

    // Back to the first query while its revalidation hangs: it repaints at once.
    hook.rerender({});
    expect(ids(view())).toEqual(['a']);
    expect(hook.result.current.data).toBeDefined();
  });

  it('hydrates a query persisted by an earlier session when switching to it', async () => {
    await persist(
      { q: 'foo' },
      { currentPage: 0, hasMore: false, items: [flat('cached-foo')], pageSize: 12, q: 'foo' },
    );
    fetchSpy.mockResolvedValueOnce(page([list.raw('a')], 1)).mockImplementation(pending);

    const hook = renderHook((query: Record<string, unknown>) => useFetch(query), {
      initialProps: {},
      wrapper,
    });
    await waitFor(() => expect(ids(view())).toEqual(['a']));

    hook.rerender({ q: 'foo' });

    await waitFor(() => expect(ids(view())).toEqual(['cached-foo']));
  });

  it('surfaces only the failure of the query on screen, and keeps painted rows', async () => {
    const rejectByQuery = new Map<string, (error: Error) => void>();
    fetchSpy.mockImplementation(
      (params: { q?: string } = {}) =>
        new Promise((_, reject) => rejectByQuery.set(params.q ?? '', reject)),
    );

    const hook = renderHook((query: Record<string, unknown>) => useFetch(query), {
      initialProps: { q: 'a' } as Record<string, unknown>,
      wrapper,
    });
    await waitFor(() => expect(rejectByQuery.has('a')).toBe(true));
    hook.rerender({ q: 'b' });
    await waitFor(() => expect(rejectByQuery.has('b')).toBe(true));

    await act(async () => {
      rejectByQuery.get('a')!(new Error('stale failure'));
    });
    expect(hook.result.current.error).toBeUndefined();

    const failure = new Error('current failure');
    await act(async () => {
      rejectByQuery.get('b')!(failure);
    });
    await waitFor(() => expect(hook.result.current.error).toBe(failure));
  });

  it('applies an edit to every loaded and persisted query', async () => {
    serve(() => ['a', 'b']);
    const hook = renderHook((query: Record<string, unknown>) => useFetch(query), {
      initialProps: {},
      wrapper,
    });
    await waitFor(async () => expect(ids(await stored())).toEqual(['a', 'b']));
    hook.rerender({ q: 'foo' });
    await waitFor(async () => expect(ids(await stored({ q: 'foo' }))).toEqual(['a', 'b']));

    act(() => {
      state()[`internal_update${list.S}Entity`]('a', (row: Row) => ({ ...row, title: 'edited' }));
    });

    expect(view()?.items[0].title).toBe('edited');
    expect(entry({})?.items[0].title).toBe('edited');
    await waitFor(async () => {
      expect((await stored())?.items[0].title).toBe('edited');
      expect((await stored({ q: 'foo' }))?.items[0].title).toBe('edited');
    });
  });

  it('purges every persisted query, not only the one on screen', async () => {
    serve(() => ['a']);
    const hook = renderHook((query: Record<string, unknown>) => useFetch(query), {
      initialProps: {},
      wrapper,
    });
    await waitFor(async () => expect(await stored()).toBeDefined());
    hook.rerender({ q: 'foo' });
    await waitFor(async () => expect(await stored({ q: 'foo' })).toBeDefined());

    let cleared = false;
    await act(async () => {
      cleared = await state()[`internal_clear${list.S}List`]();
    });

    expect(cleared).toBe(true);
    expect(state()[`${list.s}ListEntries`]).toEqual({});
    expect(state()[list.p]).toEqual([]);
    await expect(stored()).resolves.toBeUndefined();
    await expect(stored({ q: 'foo' })).resolves.toBeUndefined();
  });

  it('purges the deleted user’s persisted queries after an account switch, not the active user’s', async () => {
    serve(() => ['a']);
    const hook = renderHook((query: Record<string, unknown>) => useFetch(query), {
      initialProps: {},
      wrapper,
    });
    await waitFor(async () => expect(await stored()).toBeDefined());
    hook.rerender({ q: 'foo' });
    await waitFor(async () => expect(await stored({ q: 'foo' })).toBeDefined());
    hook.unmount();
    const deletedUser = rowScope;

    // Another account becomes active and paints its own list.
    useScope(`${list.name}-user-${randomUUID()}:personal`);
    serve(() => ['b']);
    renderHook(() => useFetch(), { wrapper });
    await waitFor(() => expect(ids(view())).toEqual(['b']));
    await waitFor(async () => expect(ids(await stored())).toEqual(['b']));

    let cleared = false;
    await act(async () => {
      cleared = await state()[`internal_clear${list.S}List`](deletedUser);
    });

    expect(cleared).toBe(true);
    const deletedRow = (query: Record<string, unknown>) =>
      list.resource.storage.get({ queryKey: storageKey(query), scope: deletedUser });
    await expect(deletedRow({})).resolves.toBeUndefined();
    await expect(deletedRow({ q: 'foo' })).resolves.toBeUndefined();
    // The active user's view and persisted row are untouched.
    expect(ids(view())).toEqual(['b']);
    expect(ids(await stored())).toEqual(['b']);
  });

  it('applies a delete confirmed after an account switch to the account that asked', async () => {
    serve(() => ['a', 'b']);
    const first = renderHook(() => useFetch(), { wrapper });
    await waitFor(async () => expect(ids(await stored())).toEqual(['a', 'b']));
    const deletingUser = rowScope;

    let finishDelete!: () => void;
    vi.spyOn(memoryCRUDService, list.deleteMethod).mockImplementation(
      () => new Promise((resolve) => (finishDelete = () => resolve(undefined))) as never,
    );
    let deleting!: Promise<void>;
    act(() => {
      deleting = remove('a');
    });
    await waitFor(() => expect(finishDelete).toBeTypeOf('function'));
    first.unmount();

    // The account switches while the server deletes; the new one shows its own 'a'.
    useScope(`${list.name}-user-${randomUUID()}:personal`);
    serve(() => ['a', 'c']);
    renderHook(() => useFetch(), { wrapper });
    await waitFor(() => expect(ids(view())).toEqual(['a', 'c']));
    await waitFor(async () => expect(ids(await stored())).toEqual(['a', 'c']));

    await act(async () => {
      finishDelete();
      await deleting;
    });

    // The asking account's persisted rows lose the row...
    await waitFor(async () =>
      expect(
        ids(
          (await list.resource.storage.get({ queryKey: storageKey(), scope: deletingUser }))
            ?.data as ListData,
        ),
      ).toEqual(['b']),
    );
    // ...while the account on screen keeps its own list.
    expect(ids(view())).toEqual(['a', 'c']);
    expect(ids(await stored())).toEqual(['a', 'c']);
  });

  it('removes a row optimistically and rolls it back when the server rejects', async () => {
    serve(() => ['a', 'b']);
    renderHook(() => useFetch(), { wrapper });
    await waitFor(() => expect(ids(view())).toEqual(['a', 'b']));

    let reject: ((error: Error) => void) | undefined;
    vi.spyOn(memoryCRUDService, list.deleteMethod).mockImplementation(
      () => new Promise((_, rej) => (reject = rej)) as never,
    );

    let deleting!: Promise<void>;
    act(() => {
      deleting = remove('a');
    });
    expect(ids(view())).toEqual(['b']);
    await waitFor(() => expect(reject).toBeTypeOf('function'));

    await act(async () => {
      reject!(new Error('offline'));
      await expect(deleting).rejects.toThrow('offline');
    });
    expect(ids(view())).toEqual(['a', 'b']);
  });

  it('drops a deleted row from the view and the persisted row', async () => {
    let server = ['a', 'b'];
    serve(() => server);
    vi.spyOn(memoryCRUDService, list.deleteMethod).mockResolvedValue(undefined as never);
    renderHook(() => useFetch(), { wrapper });
    await waitFor(() => expect(ids(view())).toEqual(['a', 'b']));

    server = ['b'];
    await act(async () => {
      await remove('a');
    });

    expect(ids(view())).toEqual(['b']);
    await waitFor(async () => expect(ids(await stored())).toEqual(['b']));
  });

  it('keeps offset pagination contiguous after deleting from a loaded page', async () => {
    let server = rowsOf(30);
    serve(() => server);
    vi.spyOn(memoryCRUDService, list.deleteMethod).mockResolvedValue(undefined as never);
    renderHook(() => useFetch(), { wrapper });
    await waitFor(() => expect(view()?.items).toHaveLength(12));
    await act(async () => {
      await loadMore();
    });
    await waitFor(() => expect(view()?.items).toHaveLength(24));

    server = server.filter((id) => id !== 'r5');
    await act(async () => {
      await remove('r5');
    });
    // Collapsed to a refetched head.
    await waitFor(() => expect(ids(view())).toEqual(server.slice(0, 12)));

    await act(async () => {
      await loadMore();
    });

    // No row skipped at the page boundary by a stale offset.
    await waitFor(() => expect(ids(view())).toEqual(server.slice(0, 24)));
  });

  it('never pages from a stale offset when the post-delete head refresh fails', async () => {
    let server = rowsOf(30);
    let headDown = false;
    fetchSpy.mockImplementation(
      async ({ page: pageNo = 1, pageSize = 12 }: { page?: number; pageSize?: number } = {}) => {
        if (pageNo === 1 && headDown) throw new Error('head down');
        const start = (pageNo - 1) * pageSize;
        return page(server.slice(start, start + pageSize).map(list.raw), server.length);
      },
    );
    vi.spyOn(memoryCRUDService, list.deleteMethod).mockResolvedValue(undefined as never);
    renderHook(() => useFetch(), { wrapper });
    await waitFor(() => expect(view()?.items).toHaveLength(12));

    server = server.filter((id) => id !== 'r5');
    headDown = true;
    await act(async () => {
      await remove('r5');
    });

    fetchSpy.mockClear();
    await act(async () => {
      await loadMore();
    });

    // The head was retried first; no page 2 was asked for, and the footer shows the failure.
    expect(fetchSpy).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
    expect(view()?.loadMoreError).toBeInstanceOf(Error);

    // The retry refreshes the head, then pages contiguously.
    headDown = false;
    await act(async () => {
      await loadMore();
    });
    await waitFor(() => expect(ids(view())).toEqual(server.slice(0, 24)));
    expect(view()?.loadMoreError).toBeUndefined();
  });

  it('never pages a persisted query a delete shortened, even after a reload, when its head refresh fails', async () => {
    let server = rowsOf(30);
    let headDown = false;
    fetchSpy.mockImplementation(
      async ({ page: pageNo = 1, pageSize = 12 }: { page?: number; pageSize?: number } = {}) => {
        if (pageNo === 1 && headDown) throw new Error('head down');
        const start = (pageNo - 1) * pageSize;
        return page(server.slice(start, start + pageSize).map(list.raw), server.length);
      },
    );
    vi.spyOn(memoryCRUDService, list.deleteMethod).mockResolvedValue(undefined as never);

    // Query B (a search) was persisted earlier...
    const search = renderHook(() => useFetch({ q: 'foo' }), { wrapper });
    await waitFor(async () => expect((await stored({ q: 'foo' }))?.items).toHaveLength(12));
    search.unmount();
    // ...and a reload leaves it in storage only.
    act(() => useUserMemoryStore.setState(initialState, false));

    // Delete from query A: B's persisted row is patched (not loaded, not marked).
    const base = renderHook(() => useFetch(), { wrapper });
    await waitFor(() => expect(view()?.items).toHaveLength(12));
    server = server.filter((id) => id !== 'r5');
    await act(async () => {
      await remove('r5');
    });
    await waitFor(async () => expect((await stored({ q: 'foo' }))?.items).toHaveLength(11));
    base.unmount();

    // Open B while its head revalidation fails: it paints the shortened row.
    headDown = true;
    const reopened = renderHook(() => useFetch({ q: 'foo' }), { wrapper });
    await waitFor(() => expect(view()?.items).toHaveLength(11));

    fetchSpy.mockClear();
    await act(async () => {
      await loadMore();
    });

    // No page 2 from the shifted offset (it would skip r12); the footer shows why.
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
    expect(view()?.loadMoreError).toBeInstanceOf(Error);

    // Once the head is back, the retry pages contiguously.
    headDown = false;
    await act(async () => {
      await loadMore();
    });
    await waitFor(() => expect(ids(view())).toEqual(server.slice(0, 24)));
    reopened.unmount();
  });

  it('makes a delete wait for a page in flight, so the page cannot land past the shift', async () => {
    let server = rowsOf(30);
    let releasePage!: () => void;
    const pageGate = new Promise<void>((resolve) => (releasePage = resolve));
    fetchSpy.mockImplementation(
      async ({ page: pageNo = 1, pageSize = 12 }: { page?: number; pageSize?: number } = {}) => {
        // The first page-2 request is held while the user deletes.
        if (pageNo === 2) await pageGate;
        const start = (pageNo - 1) * pageSize;
        return page(server.slice(start, start + pageSize).map(list.raw), server.length);
      },
    );
    const serverDelete = vi
      .spyOn(memoryCRUDService, list.deleteMethod)
      .mockImplementation(async () => {
        server = server.filter((id) => id !== 'r5');
        return undefined as never;
      });
    renderHook(() => useFetch(), { wrapper });
    await waitFor(() => expect(view()?.items).toHaveLength(12));

    let paging!: Promise<void>;
    let deleting!: Promise<void>;
    act(() => {
      paging = loadMore();
      deleting = remove('r5');
    });
    await waitFor(() => expect(view()?.isLoadingMore).toBe(true));
    expect(serverDelete).not.toHaveBeenCalled();

    await act(async () => {
      releasePage();
      await Promise.all([paging, deleting]);
    });
    await act(async () => {
      await loadMore();
    });

    await waitFor(() => expect(ids(view())).toEqual(server.slice(0, 24)));
  });

  it('reports a page in flight and a failed page for the list footer', async () => {
    let failPage = false;
    let releasePage: (() => void) | undefined;
    fetchSpy.mockImplementation(async ({ page: pageNo = 1 }: { page?: number } = {}) => {
      if (pageNo === 2) {
        await new Promise<void>((resolve) => (releasePage = resolve));
        if (failPage) throw new Error('page failed');
      }
      return page(rowsOf(12).map(list.raw), 24);
    });
    const hook = renderHook(() => useFetch(), { wrapper });
    await waitFor(() => expect(view()?.items).toHaveLength(12));
    expect(hook.result.current.isLoading).toBe(false);

    failPage = true;
    let paging!: Promise<void>;
    act(() => {
      paging = loadMore();
    });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(true));
    expect(view()?.isLoadingMore).toBe(true);

    await act(async () => {
      releasePage!();
      await paging;
    });
    expect(hook.result.current.isLoading).toBe(false);
    expect(view()?.loadMoreError).toBeInstanceOf(Error);
    // A failed page is the footer's, not a full-surface error.
    expect(hook.result.current.error).toBeUndefined();
  });

  it('does not fetch another page when the head page is the last one', async () => {
    serve(() => ['only']);
    renderHook(() => useFetch(), { wrapper });
    await waitFor(() => expect(view()?.items).toHaveLength(1));
    expect(state()[`${list.p}HasMore`]).toBe(false);

    await act(async () => {
      await loadMore();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('bounds how many query page sets are kept', async () => {
    fetchSpy.mockImplementation(async ({ q }: { q?: string } = {}) => page([list.raw(`${q}`)], 1));
    const queries = Array.from({ length: MAX_RECENT_MEMORY_QUERIES + 2 }, (_, i) => `q-${i}`);
    for (const q of queries) storageKey({ q });

    const hook = renderHook((props: { q: string }) => useFetch({ q: props.q }), {
      initialProps: { q: queries[0] },
      wrapper,
    });
    for (const q of queries.slice(1)) {
      hook.rerender({ q });
      await waitFor(() => expect(entry({ q })).toBeDefined());
    }

    expect(Object.keys(state()[`${list.s}ListEntries`])).toHaveLength(MAX_RECENT_MEMORY_QUERIES);
    expect(entry({ q: queries[0] })).toBeUndefined();
    // Evicted from IndexedDB too, not only from memory.
    await waitFor(async () => expect(await stored({ q: queries[0] })).toBeUndefined());
    expect(await stored({ q: queries.at(-1) })).toBeDefined();
  });

  it('never evicts the query on screen, however many others are visited', async () => {
    fetchSpy.mockImplementation(async ({ q }: { q?: string } = {}) => page([list.raw(`${q}`)], 1));
    const queries = Array.from({ length: MAX_RECENT_MEMORY_QUERIES + 3 }, (_, i) => `other-${i}`);
    for (const q of [...queries, 'pinned']) storageKey({ q });

    // The pinned query stays mounted (oldest of all) while the others cycle.
    renderHook(() => useFetch({ q: 'pinned' }), { wrapper });
    await waitFor(async () => expect(await stored({ q: 'pinned' })).toBeDefined());
    const other = renderHook((props: { q: string }) => useFetch({ q: props.q }), {
      initialProps: { q: queries[0] },
      wrapper,
    });
    for (const q of queries) {
      other.rerender({ q });
      await waitFor(async () => expect(await stored({ q })).toBeDefined());
    }

    expect(entry({ q: 'pinned' })).toBeDefined();
    expect(await stored({ q: 'pinned' })).toBeDefined();
    await waitFor(async () => expect(await stored({ q: queries[0] })).toBeUndefined());
  });

  it('keeps the cap across reloads, from the queries an earlier session persisted', async () => {
    // An earlier session persisted the cap's worth of queries (index oldest first).
    const previous = Array.from({ length: MAX_RECENT_MEMORY_QUERIES }, (_, i) => `old-${i}`);
    for (const q of previous) {
      await persist({ q }, { currentPage: 0, hasMore: false, items: [flat(q)], pageSize: 12, q });
    }
    await list.resource.storage.set(
      { queryKey: REPLICA_INDEX_KEY, scope: rowScope },
      { data: previous.map((q) => storageKey({ q })), updatedAt: 1 },
    );
    fetchSpy.mockImplementation(async ({ q }: { q?: string } = {}) => page([list.raw(`${q}`)], 1));
    storageKey({ q: 'fresh' });

    renderHook(() => useFetch({ q: 'fresh' }), { wrapper });
    await waitFor(async () => expect(await stored({ q: 'fresh' })).toBeDefined());

    // The least recently used persisted query made room; the others stay.
    await waitFor(async () => expect(await stored({ q: 'old-0' })).toBeUndefined());
    expect(await stored({ q: 'old-1' })).toBeDefined();
    const index = await list.resource.storage.get({ queryKey: REPLICA_INDEX_KEY, scope: rowScope });
    expect(index?.data as string[]).toHaveLength(MAX_RECENT_MEMORY_QUERIES);
  });
});
