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

import { normalizeResourceListParams, RESOURCE_LIST_KEY, resourceListResource } from './projection';

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
  let scope = '';
  let querySpy: ReturnType<typeof vi.spyOn>;

  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  beforeEach(() => {
    useScope(`resource-user-${randomUUID()}:personal`);
    querySpy = vi.spyOn(resourceService, 'queryResources');
    act(() => useFileStore.setState(initialState));
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].map((value) =>
        resourceListResource.storage!.remove({ queryKey: BASE_KEY, scope: value }),
      ),
    );
    scopes.clear();
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
});
