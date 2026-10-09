/**
 * @vitest-environment happy-dom
 *
 * The explorer list is a `@lobechat/replica` paged resource: the persisted head
 * page paints before the network answers, the response confirms and persists it,
 * "load more" appends through the engine, and a query change repaints from its
 * own head page instead of appending to the previous folder's rows.
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
import { initialState } from '@/store/file/initialState';
import { useFileStore } from '@/store/file/store';
import type { ResourceItem } from '@/types/resource';

import type { ResourceListParams } from './projection';
import { normalizeResourceListParams, RESOURCE_LIST_KEY, resourceListResource } from './projection';

vi.mock('@/services/knowledgeBase', () => ({
  knowledgeBaseService: {
    addFilesToKnowledgeBase: vi.fn(async () => undefined),
    removeFilesFromKnowledgeBase: vi.fn(async () => undefined),
  },
}));

const BASE_INPUT = { parentId: null } as const;
const BASE_PARAMS = normalizeResourceListParams(BASE_INPUT)!;
const BASE_KEY = resourceListResource.storageKey(BASE_PARAMS);

const row = (id: string): ResourceItem => ({
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  fileType: 'text/plain',
  id,
  name: id,
  parentId: null,
  size: 1,
  sourceType: 'file',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  url: `files/${id}.txt`,
});

const ids = () => useFileStore.getState().resourceList.map((item) => item.id);
const page = (items: ResourceItem[], total: number) => ({ items, total });
const rows = (length: number, offset = 0) =>
  Array.from({ length }, (_, i) => row(`resource-${i + offset}`));

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

describe('resourceList replica', () => {
  const scopes = new Set<string>();
  /** Storage rows written by a test, so each one is cleaned up after it. */
  const seededQueryKeys = new Set<string>([BASE_KEY]);
  let scope = '';
  let querySpy: ReturnType<typeof vi.spyOn>;

  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  /** Seed a persisted head page exactly as the engine would have written it. */
  const seedPersisted = async (params: ResourceListParams, items: ResourceItem[]) => {
    const queryKey = resourceListResource.storageKey(params);
    seededQueryKeys.add(queryKey);
    await resourceListResource.storage!.set(
      { queryKey, scope },
      {
        data: {
          currentPage: 0,
          hasMore: false,
          items,
          nextCursor: null,
          pageSize: params.pageSize ?? 50,
          queryParams: params,
          total: items.length,
        },
        updatedAt: 1,
      },
    );
  };

  beforeEach(() => {
    useScope(`resource-user-${randomUUID()}:personal`);
    querySpy = vi.spyOn(resourceService, 'queryResources');
    act(() => useFileStore.setState(initialState));
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].flatMap((value) =>
        [...seededQueryKeys].map((queryKey) =>
          resourceListResource.storage!.remove({ queryKey, scope: value }),
        ),
      ),
    );
    scopes.clear();
    seededQueryKeys.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('reads the list from a single entry', () => {
    expect(RESOURCE_LIST_KEY).toBe('current');
  });

  it('paints the persisted head page before the network answers', async () => {
    await resourceListResource.storage!.set(
      { queryKey: BASE_KEY, scope },
      {
        data: {
          currentPage: 0,
          hasMore: true,
          items: [row('cached-1')],
          nextCursor: 1,
          pageSize: 50,
          queryParams: BASE_PARAMS,
          total: 2,
        },
        updatedAt: 1,
      },
    );
    querySpy.mockImplementation(pending);

    const hook = renderHook(
      () => ({
        sync: useFileStore((s) => s.useFetchResources)(BASE_INPUT),
      }),
      { wrapper },
    );

    await waitFor(() => expect(ids()).toEqual(['cached-1']));
    expect(hook.result.current.sync.isHydrated).toBe(true);
    expect(hook.result.current.sync.isValidating).toBe(true);
    expect(useFileStore.getState().resourceMap.get('cached-1')).toMatchObject({ name: 'cached-1' });
  });

  it('replaces the head page with the server response and persists it', async () => {
    querySpy.mockResolvedValue(page([row('a'), row('b')], 40));

    renderHook(() => useFileStore((s) => s.useFetchResources)(BASE_INPUT), { wrapper });

    await waitFor(() => expect(ids()).toEqual(['a', 'b']));
    expect(useFileStore.getState()).toMatchObject({ hasMore: true, total: 40 });

    await waitFor(async () => {
      const persisted = await resourceListResource.storage!.get({ queryKey: BASE_KEY, scope });
      expect((persisted?.data.items as ResourceItem[] | undefined)?.map((item) => item.id)).toEqual(
        ['a', 'b'],
      );
    });
  });

  it('appends the next page with the loaded query params', async () => {
    querySpy
      .mockResolvedValueOnce(page(rows(50), 120))
      .mockResolvedValueOnce(page(rows(50, 50), 120));

    const hook = renderHook(() => useFileStore((s) => s.useFetchResources)(BASE_INPUT), {
      wrapper,
    });

    await waitFor(() => expect(useFileStore.getState().resourceList).toHaveLength(50));

    await act(async () => {
      await useFileStore.getState().loadMoreResources();
    });

    expect(ids()).toHaveLength(100);
    expect(ids()[50]).toBe('resource-50');
    expect(useFileStore.getState().hasMore).toBe(true);
    // The replica owns the cursor: page 2 of the loaded query, offset 50.
    expect(querySpy).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50, offset: 50 }));
    expect(hook).toBeDefined();
  });

  it('repaints from its own head page when the query changes', async () => {
    querySpy
      .mockResolvedValueOnce(page(rows(50), 120))
      .mockResolvedValueOnce(page([row('foo-1')], 1));

    const hook = renderHook(
      (props: { q?: string }) =>
        useFileStore((s) => s.useFetchResources)({ parentId: null, q: props.q }),
      { initialProps: {} as { q?: string }, wrapper },
    );

    await waitFor(() => expect(useFileStore.getState().resourceList).toHaveLength(50));

    hook.rerender({ q: 'foo' });

    await waitFor(() => expect(ids()).toEqual(['foo-1']));
    expect(useFileStore.getState().queryParams?.q).toBe('foo');
    expect(useFileStore.getState().total).toBe(1);
  });

  it('drops the painted rows on clear but keeps the queried params', async () => {
    querySpy.mockResolvedValue(page([row('a')], 1));

    renderHook(() => useFileStore((s) => s.useFetchResources)(BASE_INPUT), { wrapper });

    await waitFor(() => expect(ids()).toEqual(['a']));

    act(() => useFileStore.getState().clearCurrentQueryResources());

    expect(ids()).toEqual([]);
    expect(useFileStore.getState().resourceMap.size).toBe(0);
    // The queried params survive so the views can tell the request moved on.
    expect(useFileStore.getState().queryParams?.parentId).toBeNull();
  });

  it('does not fetch another page when the head page is the last one', async () => {
    querySpy.mockResolvedValue(page([row('only')], 1));

    renderHook(() => useFileStore((s) => s.useFetchResources)(BASE_INPUT), { wrapper });

    await waitFor(() => expect(useFileStore.getState().resourceList).toHaveLength(1));
    expect(useFileStore.getState().hasMore).toBe(false);

    await act(async () => {
      await useFileStore.getState().loadMoreResources();
    });

    expect(querySpy).toHaveBeenCalledTimes(1);
  });

  it('reports isLoading only while nothing is painted', async () => {
    querySpy.mockImplementation(pending);

    const hook = renderHook(() => useFileStore((s) => s.useFetchResources)(BASE_INPUT), {
      wrapper,
    });

    expect(hook.result.current.isLoading).toBe(true);
    expect(useFileStore.getState().resourceList).toEqual([]);
  });

  it('keeps a pending upload row across a head revalidation and out of storage', async () => {
    querySpy.mockResolvedValue(page([row('server-1')], 1));

    const hook = renderHook(
      () => ({ sync: useFileStore((s) => s.useFetchResources)(BASE_INPUT) }),
      {
        wrapper,
      },
    );

    await waitFor(() => expect(ids()).toEqual(['server-1']));

    act(() =>
      useFileStore.getState().insertLocalResource(
        {
          fileType: 'text/plain',
          name: 'Uploading',
          size: 3,
          sourceType: 'file',
          url: '',
        },
        'temp-upload',
      ),
    );
    expect(ids()).toEqual(['temp-upload', 'server-1']);

    // A focus / reconnect head response no longer carries the pending row.
    querySpy.mockResolvedValue(page([row('server-1')], 1));
    await act(async () => {
      await hook.result.current.sync.mutate();
    });

    // The local row survives the refresh ...
    expect(ids()).toContain('temp-upload');
    // ... without ever reaching the persisted head page.
    const persisted = await resourceListResource.storage!.get({ queryKey: BASE_KEY, scope });
    expect((persisted?.data.items as ResourceItem[]).map((item) => item.id)).toEqual(['server-1']);
  });

  it('paints a previously visited folder from its persisted page on navigation', async () => {
    const paramsB = normalizeResourceListParams({ parentId: 'folder-b' })!;
    await seedPersisted(paramsB, [row('cached-b')]);

    // Folder A answers; folder B never does — only its cache can paint it.
    querySpy.mockImplementation((params) =>
      params.parentId === 'folder-b' ? pending() : Promise.resolve(page([row('a-1')], 1)),
    );

    const hook = renderHook(
      (props: { parentId: string | null }) =>
        useFileStore((s) => s.useFetchResources)({ parentId: props.parentId }),
      { initialProps: { parentId: null as string | null }, wrapper },
    );

    await waitFor(() => expect(ids()).toEqual(['a-1']));

    hook.rerender({ parentId: 'folder-b' });

    await waitFor(() => expect(ids()).toEqual(['cached-b']));
    expect(useFileStore.getState().queryParams?.parentId).toBe('folder-b');
  });

  it('restores each folder from its persisted page when navigating back offline', async () => {
    const paramsA = normalizeResourceListParams({ parentId: null })!;
    const paramsB = normalizeResourceListParams({ parentId: 'folder-b' })!;
    await seedPersisted(paramsA, [row('cached-a')]);
    await seedPersisted(paramsB, [row('cached-b')]);
    querySpy.mockImplementation(pending);

    const hook = renderHook(
      (props: { parentId: string | null }) =>
        useFileStore((s) => s.useFetchResources)({ parentId: props.parentId }),
      { initialProps: { parentId: null as string | null }, wrapper },
    );

    await waitFor(() => expect(ids()).toEqual(['cached-a']));

    hook.rerender({ parentId: 'folder-b' });
    await waitFor(() => expect(ids()).toEqual(['cached-b']));

    // The once-per-key driver read of folder A already ran, so coming back must
    // hydrate it again rather than wait for a network that is not there.
    hook.rerender({ parentId: null });
    await waitFor(() => expect(ids()).toEqual(['cached-a']));
  });

  it('paints a previously cached sort from its persisted page', async () => {
    const sortedParams = normalizeResourceListParams({
      parentId: null,
      sorter: 'size',
      sortType: 'asc',
    })!;
    await seedPersisted(sortedParams, [row('cached-sorted')]);

    // Only the default (newest-first) query answers; the sorted one is offline.
    querySpy.mockImplementation((params) =>
      params.sorter === 'size' ? pending() : Promise.resolve(page([row('newest-1')], 1)),
    );

    const hook = renderHook(
      (props: { sorter?: 'size' }) =>
        useFileStore((s) => s.useFetchResources)({
          parentId: null,
          sorter: props.sorter,
          sortType: props.sorter ? 'asc' : undefined,
        }),
      { initialProps: {} as { sorter?: 'size' }, wrapper },
    );

    await waitFor(() => expect(ids()).toEqual(['newest-1']));

    // Same pool, different storage row: the cached page must still hydrate.
    hook.rerender({ sorter: 'size' });

    await waitFor(() => expect(ids()).toEqual(['cached-sorted']));
  });

  it('does not carry a pending create into the folder the user navigates to', async () => {
    const paramsB = normalizeResourceListParams({ parentId: 'folder-b' })!;
    await seedPersisted(paramsB, [row('cached-b')]);
    querySpy.mockImplementation((params) =>
      params.parentId === 'folder-a' ? Promise.resolve(page([row('a-1')], 1)) : pending(),
    );
    // The create never settles: its overlay stays in flight across the switch.
    const createSpy = vi.spyOn(resourceService, 'createResource').mockImplementation(pending);

    const hook = renderHook(
      (props: { parentId: string | null }) =>
        useFileStore((s) => s.useFetchResources)({ parentId: props.parentId }),
      { initialProps: { parentId: 'folder-a' as string | null }, wrapper },
    );

    await waitFor(() => expect(ids()).toEqual(['a-1']));

    act(() => {
      void useFileStore.getState().createResourceAndSync({
        fileType: 'text/plain',
        name: 'New',
        parentId: 'folder-a',
        sourceType: 'file',
        url: '',
      });
    });
    expect(ids()[0].startsWith('temp-resource-')).toBe(true);

    hook.rerender({ parentId: 'folder-b' });

    // Folder B's cached page paints and the overlay from folder A stays out.
    await waitFor(() => expect(ids()).toEqual(['cached-b']));
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('does not surface an upload from another folder when the next folder answers', async () => {
    querySpy.mockImplementation((params) =>
      Promise.resolve(
        params.parentId === 'folder-b' ? page([row('b-1')], 1) : page([row('a-1')], 1),
      ),
    );

    const hook = renderHook(
      (props: { parentId: string | null }) =>
        useFileStore((s) => s.useFetchResources)({ parentId: props.parentId }),
      { initialProps: { parentId: 'folder-a' as string | null }, wrapper },
    );

    await waitFor(() => expect(ids()).toEqual(['a-1']));

    act(() =>
      useFileStore.getState().insertLocalResource(
        {
          fileType: 'text/plain',
          name: 'Uploading',
          parentId: 'folder-a',
          size: 3,
          sourceType: 'file',
          url: '',
        },
        'temp-upload',
      ),
    );
    expect(ids()).toEqual(['temp-upload', 'a-1']);

    // Folder B has no cache, so its head response merges against A's view: the
    // upload belongs to A's pool and must not follow the user.
    hook.rerender({ parentId: 'folder-b' });

    await waitFor(() => expect(ids()).toEqual(['b-1']));
  });

  it('confirms the page with the server after removing rows from a knowledge base view', async () => {
    querySpy.mockResolvedValueOnce(page(rows(50), 60)).mockResolvedValueOnce(page(rows(50, 1), 59));

    renderHook(() => useFileStore((s) => s.useFetchResources)({ libraryId: 'kb-1' }), { wrapper });

    await waitFor(() => expect(ids()).toHaveLength(50));
    expect(ids()[0]).toBe('resource-0');

    // Removing a row shrinks the server's page, so the loaded offset no longer
    // lines up; the action must confirm the page instead of leaving a gap that
    // the next "load more" would skip.
    await act(async () => {
      await useFileStore.getState().removeResourcesFromKnowledgeBase('kb-1', ['resource-0']);
    });

    await waitFor(() => expect(ids()[0]).toBe('resource-1'));
    expect(ids()).not.toContain('resource-0');
    expect(querySpy).toHaveBeenCalledTimes(2);
  });
});
