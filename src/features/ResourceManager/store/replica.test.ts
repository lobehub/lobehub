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

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { resourceService } from '@/services/resource';
import type { ResourceItem } from '@/types/resource';

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
        entry: useResourceManagerStore((s) => s.explorerSearchEntry),
        sync: useResourceManagerStore((s) => s.useFetchExplorerSearch)(EXPLORER_PARAMS),
      }),
      { wrapper },
    );

    await waitFor(() =>
      expect(ids(useResourceManagerStore.getState().explorerSearchEntry)).toEqual(['cached-1']),
    );
    expect(hook.result.current.sync.isHydrated).toBe(true);
    expect(hook.result.current.sync.isValidating).toBe(true);
  });

  it('replaces the explorer search head page with the response and persists it', async () => {
    fetchSpy.mockResolvedValue(page([item('a'), item('b')], 60));

    renderHook(() => useResourceManagerStore((s) => s.useFetchExplorerSearch)(EXPLORER_PARAMS), {
      wrapper,
    });

    await waitFor(() =>
      expect(ids(useResourceManagerStore.getState().explorerSearchEntry)).toEqual(['a', 'b']),
    );
    expect(useResourceManagerStore.getState().explorerSearchEntry).toMatchObject({
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
      expect(useResourceManagerStore.getState().explorerSearchEntry?.items).toHaveLength(
        DEFAULT_SEARCH_PAGE_SIZE,
      ),
    );

    hook.rerender({ q: 'foo' });

    await waitFor(() =>
      expect(ids(useResourceManagerStore.getState().explorerSearchEntry)).toEqual(['foo-1']),
    );
    // A different keyword resets the loaded depth; rows never merge across searches.
    expect(useResourceManagerStore.getState().explorerSearchEntry).toMatchObject({
      currentPage: 0,
      searchParams: { pageSize: DEFAULT_SEARCH_PAGE_SIZE, q: 'foo' },
      total: 1,
    });
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
      expect(useResourceManagerStore.getState().hierarchySearchEntry?.items).toHaveLength(
        DEFAULT_SEARCH_PAGE_SIZE,
      ),
    );

    await act(async () => {
      await hook.result.current.loadMore();
    });

    const list = useResourceManagerStore.getState().hierarchySearchEntry!;
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

    await waitFor(() =>
      expect(ids(useResourceManagerStore.getState().explorerSearchEntry)).toEqual(['explorer-hit']),
    );
    await waitFor(() =>
      expect(ids(useResourceManagerStore.getState().hierarchySearchEntry)).toEqual(['kb-hit']),
    );
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

    await waitFor(() =>
      expect(useResourceManagerStore.getState().hierarchySearchEntry?.items).toHaveLength(1),
    );
    expect(useResourceManagerStore.getState().hierarchySearchEntry?.hasMore).toBe(false);

    await act(async () => {
      await hook.result.current.loadMore();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
