/**
 * @vitest-environment happy-dom
 *
 * The ResourceManager's two search surfaces are `@lobechat/replica` paged
 * resources owned by the feature store: the persisted head page paints before
 * the network answers, the response confirms and persists it, "load more"
 * appends through the engine, and a new keyword repaints from its own head page
 * instead of merging into the previous search.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, REPLICA_INDEX_KEY } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { resourceService } from '@/services/resource';
import type { ResourceItem } from '@/types/resource';

import { MAX_RECENT_SEARCHES } from './action';
import { useResourceManagerStore } from './index';
import { initialState } from './initialState';
import {
  DEFAULT_SEARCH_PAGE_SIZE,
  type ExplorerSearchParams,
  explorerSearchResource,
  type HierarchySearchParams,
  hierarchySearchResource,
} from './projection';

const EXPLORER_PARAMS: ExplorerSearchParams = {
  pageSize: DEFAULT_SEARCH_PAGE_SIZE,
  q: 'report',
};
const EXPLORER_KEY = explorerSearchResource.storageKey(EXPLORER_PARAMS);

const HIERARCHY_PARAMS: HierarchySearchParams = {
  libraryId: 'kb-1',
  pageSize: DEFAULT_SEARCH_PAGE_SIZE,
  q: 'report',
};
const HIERARCHY_KEY = hierarchySearchResource.storageKey(HIERARCHY_PARAMS);

/**
 * Every query keeps its own replica entry, so the tests read (and assert on)
 * the entry named by the query, exactly as the components do.
 */
const explorerKeyOf = (params: ExplorerSearchParams) => explorerSearchResource.key(params);
const hierarchyKeyOf = (params: HierarchySearchParams) => hierarchySearchResource.key(params);
const explorerEntry = (params: ExplorerSearchParams) =>
  useResourceManagerStore.getState().explorerSearchEntries[explorerKeyOf(params)];
const hierarchyEntry = (params: HierarchySearchParams) =>
  useResourceManagerStore.getState().hierarchySearchEntries[hierarchyKeyOf(params)];

const item = (id: string): ResourceItem => ({ fileType: 'custom/document', id, name: id });

const itemsOf = (length: number, offset = 0) =>
  Array.from({ length }, (_, i) => item(`file-${i + offset}`));

const page = (items: ResourceItem[], total?: number) => ({
  hasMore: total === undefined ? items.length >= DEFAULT_SEARCH_PAGE_SIZE : total > items.length,
  items,
  total,
});

const ids = (list: { items: ResourceItem[] } | undefined) => list?.items.map((entry) => entry.id);

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

describe('ResourceManager search replicas', () => {
  const scopes = new Set<string>();
  let scope = '';
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  beforeEach(() => {
    useScope(`rm-user-${randomUUID()}:personal`);
    fetchSpy = vi.spyOn(resourceService, 'queryResources');
    act(() => useResourceManagerStore.setState(initialState));
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes]
        .flatMap((value) =>
          [EXPLORER_KEY, HIERARCHY_KEY].map((queryKey) =>
            Promise.all([
              explorerSearchResource.storage!.remove({ queryKey, scope: value }),
              hierarchySearchResource.storage!.remove({ queryKey, scope: value }),
            ]),
          ),
        )
        .flat(),
    );
    await Promise.all(
      [...scopes].flatMap((value) =>
        [explorerSearchResource, hierarchySearchResource].map((resource) =>
          resource.storage!.remove({ queryKey: REPLICA_INDEX_KEY, scope: value }),
        ),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted explorer search head page before the network answers', async () => {
    await explorerSearchResource.storage!.set(
      { queryKey: EXPLORER_KEY, scope },
      {
        data: {
          currentPage: 0,
          hasMore: true,
          items: [item('cached-1')],
          pageSize: DEFAULT_SEARCH_PAGE_SIZE,
          searchParams: EXPLORER_PARAMS,
          total: 60,
        },
        updatedAt: 1,
      },
    );
    fetchSpy.mockImplementation(pending);

    const hook = renderHook(
      () => ({
        entry: useResourceManagerStore(
          (s) => s.explorerSearchEntries[explorerKeyOf(EXPLORER_PARAMS)],
        ),
        sync: useResourceManagerStore((s) => s.useFetchExplorerSearch)(EXPLORER_PARAMS),
      }),
      { wrapper },
    );

    await waitFor(() => expect(ids(explorerEntry(EXPLORER_PARAMS))).toEqual(['cached-1']));
    expect(hook.result.current.sync.isHydrated).toBe(true);
    expect(hook.result.current.sync.isValidating).toBe(true);
  });

  it('replaces the explorer search head page with the response and persists it', async () => {
    fetchSpy.mockResolvedValue(page([item('a'), item('b')], 60));

    renderHook(() => useResourceManagerStore((s) => s.useFetchExplorerSearch)(EXPLORER_PARAMS), {
      wrapper,
    });

    await waitFor(() => expect(ids(explorerEntry(EXPLORER_PARAMS))).toEqual(['a', 'b']));
    expect(explorerEntry(EXPLORER_PARAMS)).toMatchObject({
      hasMore: true,
      searchParams: EXPLORER_PARAMS,
      total: 60,
    });

    await waitFor(async () => {
      const row = await explorerSearchResource.storage!.get({ queryKey: EXPLORER_KEY, scope });
      expect(ids(row?.data)).toEqual(['a', 'b']);
    });
  });

  it('repaints the explorer search from its own head page when the keyword changes', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        hasMore: true,
        items: itemsOf(DEFAULT_SEARCH_PAGE_SIZE),
        total: 100,
      })
      .mockResolvedValueOnce({ hasMore: false, items: [item('foo-1')], total: 1 });

    const hook = renderHook(
      (props: { q: string }) =>
        useResourceManagerStore((s) => s.useFetchExplorerSearch)({
          pageSize: DEFAULT_SEARCH_PAGE_SIZE,
          q: props.q,
        }),
      { initialProps: { q: 'report' }, wrapper },
    );

    await waitFor(() =>
      expect(
        explorerEntry({ pageSize: DEFAULT_SEARCH_PAGE_SIZE, q: 'report' })?.items,
      ).toHaveLength(DEFAULT_SEARCH_PAGE_SIZE),
    );

    hook.rerender({ q: 'foo' });

    await waitFor(() =>
      expect(ids(explorerEntry({ pageSize: DEFAULT_SEARCH_PAGE_SIZE, q: 'foo' }))).toEqual([
        'foo-1',
      ]),
    );
    // Each keyword owns its entry: the new one starts at its own head page and
    // the rows of the previous search never merge into it.
    expect(explorerEntry({ pageSize: DEFAULT_SEARCH_PAGE_SIZE, q: 'foo' })).toMatchObject({
      currentPage: 0,
      searchParams: { pageSize: DEFAULT_SEARCH_PAGE_SIZE, q: 'foo' },
      total: 1,
    });
    expect(explorerEntry({ pageSize: DEFAULT_SEARCH_PAGE_SIZE, q: 'report' })?.items).toHaveLength(
      DEFAULT_SEARCH_PAGE_SIZE,
    );
  });

  it('appends the next sidebar search page through the engine', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        hasMore: true,
        items: itemsOf(DEFAULT_SEARCH_PAGE_SIZE),
        total: 100,
      })
      .mockResolvedValueOnce({
        hasMore: true,
        items: itemsOf(DEFAULT_SEARCH_PAGE_SIZE, DEFAULT_SEARCH_PAGE_SIZE),
        total: 100,
      });

    const hook = renderHook(
      () => ({
        loadMore: useResourceManagerStore((s) => s.loadMoreHierarchySearch),
        sync: useResourceManagerStore((s) => s.useFetchHierarchySearch)(HIERARCHY_PARAMS),
      }),
      { wrapper },
    );

    await waitFor(() =>
      expect(hierarchyEntry(HIERARCHY_PARAMS)?.items).toHaveLength(DEFAULT_SEARCH_PAGE_SIZE),
    );

    await act(async () => {
      await hook.result.current.loadMore(hierarchyKeyOf(HIERARCHY_PARAMS));
    });

    const list = hierarchyEntry(HIERARCHY_PARAMS)!;
    expect(list.items).toHaveLength(DEFAULT_SEARCH_PAGE_SIZE * 2);
    expect(list.items[DEFAULT_SEARCH_PAGE_SIZE].id).toBe(`file-${DEFAULT_SEARCH_PAGE_SIZE}`);
    expect(list.currentPage).toBe(1);
    // The replica owns the cursor: the second page of the loaded query.
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        libraryId: 'kb-1',
        limit: DEFAULT_SEARCH_PAGE_SIZE,
        offset: DEFAULT_SEARCH_PAGE_SIZE,
        q: 'report',
      }),
    );
  });

  it('keeps the explorer and sidebar searches in separate entries', async () => {
    fetchSpy.mockImplementation(({ libraryId }: { libraryId?: string }) =>
      Promise.resolve(page(libraryId ? [item('kb-hit')] : [item('explorer-hit')], 1)),
    );

    renderHook(
      () => ({
        explorer: useResourceManagerStore((s) => s.useFetchExplorerSearch)(EXPLORER_PARAMS),
        hierarchy: useResourceManagerStore((s) => s.useFetchHierarchySearch)(HIERARCHY_PARAMS),
      }),
      { wrapper },
    );

    await waitFor(() => expect(ids(explorerEntry(EXPLORER_PARAMS))).toEqual(['explorer-hit']));
    await waitFor(() => expect(ids(hierarchyEntry(HIERARCHY_PARAMS))).toEqual(['kb-hit']));
  });

  it('does not fetch another sidebar page when the head page is the last one', async () => {
    fetchSpy.mockResolvedValue({ hasMore: false, items: [item('only')], total: 1 });

    const hook = renderHook(
      () => ({
        loadMore: useResourceManagerStore((s) => s.loadMoreHierarchySearch),
        sync: useResourceManagerStore((s) => s.useFetchHierarchySearch)(HIERARCHY_PARAMS),
      }),
      { wrapper },
    );

    await waitFor(() => expect(hierarchyEntry(HIERARCHY_PARAMS)?.items).toHaveLength(1));
    expect(hierarchyEntry(HIERARCHY_PARAMS)?.hasMore).toBe(false);

    await act(async () => {
      await hook.result.current.loadMore(hierarchyKeyOf(HIERARCHY_PARAMS));
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('restores a revisited keyword from its own entry (no waiting for the network)', async () => {
    fetchSpy.mockImplementation(({ q }: { q?: string }) =>
      Promise.resolve(page([item(`${q}-hit`)], 1)),
    );

    const hook = renderHook(
      (props: { q: string }) =>
        useResourceManagerStore((s) => s.useFetchExplorerSearch)({
          pageSize: DEFAULT_SEARCH_PAGE_SIZE,
          q: props.q,
        }),
      { initialProps: { q: 'report' }, wrapper },
    );

    const reportParams = { pageSize: DEFAULT_SEARCH_PAGE_SIZE, q: 'report' };
    const fooParams = { pageSize: DEFAULT_SEARCH_PAGE_SIZE, q: 'foo' };

    await waitFor(() => expect(ids(explorerEntry(reportParams))).toEqual(['report-hit']));

    hook.rerender({ q: 'foo' });
    await waitFor(() => expect(ids(explorerEntry(fooParams))).toEqual(['foo-hit']));

    hook.rerender({ q: 'report' });

    // The previous search kept its own entry, so its rows are back on the very
    // next render — the component never falls back to a waiting state.
    expect(ids(explorerEntry(reportParams))).toEqual(['report-hit']);
    expect(ids(explorerEntry(fooParams))).toEqual(['foo-hit']);
  });

  it('bounds how many search entries (memory + storage) are kept', async () => {
    fetchSpy.mockImplementation(({ q }: { q?: string }) =>
      Promise.resolve(page([item(`${q}-hit`)], 1)),
    );

    const queries = Array.from({ length: MAX_RECENT_SEARCHES + 2 }, (_, i) => `q-${i}`);
    const params = (q: string) => ({ pageSize: DEFAULT_SEARCH_PAGE_SIZE, q });

    const hook = renderHook(
      (props: { q: string }) =>
        useResourceManagerStore((s) => s.useFetchExplorerSearch)(params(props.q)),
      { initialProps: { q: queries[0] }, wrapper },
    );

    for (const q of queries.slice(1)) {
      hook.rerender({ q });
      await waitFor(() => expect(explorerEntry(params(q))).toBeDefined());
    }

    const entries = useResourceManagerStore.getState().explorerSearchEntries;
    expect(Object.keys(entries)).toHaveLength(MAX_RECENT_SEARCHES);
    // The first keyword fell out of the bounded recent-query window.
    expect(explorerEntry(params(queries[0]))).toBeUndefined();
    expect(explorerEntry(params(queries.at(-1)!))).toBeDefined();
  });

  it('collapseHierarchySearch drops the loaded depth so no stale tail can survive', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        hasMore: true,
        items: itemsOf(DEFAULT_SEARCH_PAGE_SIZE),
        total: 100,
      })
      .mockResolvedValueOnce({
        hasMore: true,
        items: itemsOf(DEFAULT_SEARCH_PAGE_SIZE, DEFAULT_SEARCH_PAGE_SIZE),
        total: 100,
      });

    const hook = renderHook(
      () => ({
        loadMore: useResourceManagerStore((s) => s.loadMoreHierarchySearch),
        sync: useResourceManagerStore((s) => s.useFetchHierarchySearch)(HIERARCHY_PARAMS),
      }),
      { wrapper },
    );

    await waitFor(() =>
      expect(hierarchyEntry(HIERARCHY_PARAMS)?.items).toHaveLength(DEFAULT_SEARCH_PAGE_SIZE),
    );
    await act(async () => {
      await hook.result.current.loadMore(hierarchyKeyOf(HIERARCHY_PARAMS));
    });
    expect(hierarchyEntry(HIERARCHY_PARAMS)?.currentPage).toBe(1);

    await act(async () => {
      await useResourceManagerStore.getState().collapseHierarchySearch();
    });

    const list = hierarchyEntry(HIERARCHY_PARAMS)!;
    expect(list.currentPage).toBe(0);
    expect(list.items).toHaveLength(DEFAULT_SEARCH_PAGE_SIZE);
    expect(list.hasMore).toBe(true);
  });

  it('bounds the window across reloads, from the searches an earlier session persisted', async () => {
    // Emulate a page that persisted MORE queries than the window before this
    // store instance existed: the rows, plus the engine's index of them. The
    // in-memory recency list alone cannot see these, so without seeding it the
    // window would start empty and persist another cap on top of them.
    const previous = Array.from({ length: MAX_RECENT_SEARCHES + 2 }, (_, i) => `old-${i}`);
    const paramsOf = (q: string) => ({ pageSize: DEFAULT_SEARCH_PAGE_SIZE, q });
    for (const q of previous) {
      await explorerSearchResource.storage!.set(
        { queryKey: explorerSearchResource.storageKey(paramsOf(q)), scope },
        {
          data: {
            currentPage: 0,
            hasMore: false,
            items: [item(`${q}-hit`)],
            pageSize: DEFAULT_SEARCH_PAGE_SIZE,
            searchParams: paramsOf(q),
            total: 1,
          },
          updatedAt: 1,
        },
      );
    }
    // The engine's index holds the storage keys it persisted (the JSON query
    // identity), not the raw keywords.
    await explorerSearchResource.storage!.set(
      { queryKey: REPLICA_INDEX_KEY, scope },
      { data: previous.map((q) => explorerSearchResource.storageKey(paramsOf(q))), updatedAt: 1 },
    );

    const remove = vi.spyOn(explorerSearchResource.storage!, 'remove');
    fetchSpy.mockImplementation(({ q }: { q?: string }) =>
      Promise.resolve(page([item(`${q}-hit`)], 1)),
    );

    renderHook(() => useResourceManagerStore((s) => s.useFetchExplorerSearch)(paramsOf('fresh')), {
      wrapper,
    });

    // Seeding put the persisted queries ahead of this session's own entry, so
    // eviction reached the oldest three of THEM — the bound now spans sessions.
    const evicted = (q: string) => explorerSearchResource.storageKey(paramsOf(q));
    await waitFor(() =>
      expect(remove.mock.calls.map(([key]) => key.queryKey)).toEqual(
        previous.slice(0, previous.length - MAX_RECENT_SEARCHES + 1).map(evicted),
      ),
    );
    expect(remove).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: evicted('fresh') }),
    );
  });

  it('drops a sidebar search an earlier session persisted when the tree changes', async () => {
    const staleParams: HierarchySearchParams = {
      libraryId: 'kb-1',
      pageSize: DEFAULT_SEARCH_PAGE_SIZE,
      q: 'stale',
    };
    const staleKey = hierarchySearchResource.storageKey(staleParams);
    await hierarchySearchResource.storage!.set(
      { queryKey: staleKey, scope },
      {
        data: {
          currentPage: 0,
          hasMore: false,
          items: [item('stale-hit')],
          pageSize: DEFAULT_SEARCH_PAGE_SIZE,
          searchParams: staleParams,
          total: 1,
        },
        updatedAt: 1,
      },
    );
    await hierarchySearchResource.storage!.set(
      { queryKey: REPLICA_INDEX_KEY, scope },
      { data: [staleKey], updatedAt: 1 },
    );

    // Not loaded this session: memory and the SWR cache are both empty for it,
    // which is exactly the case the in-memory collapse loop cannot reach.
    expect(hierarchyEntry(staleParams)).toBeUndefined();

    await act(async () => {
      await useResourceManagerStore.getState().collapseHierarchySearch();
    });

    await waitFor(async () => {
      expect(
        await hierarchySearchResource.storage!.get({ queryKey: staleKey, scope }),
      ).toBeUndefined();
    });
  });
});
