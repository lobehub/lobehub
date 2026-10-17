/**
 * @vitest-environment happy-dom
 *
 * The recycle-bin list and its per-type counts are replicas: the list paints
 * from the persisted copy on the first frame, the network only confirms, and a
 * restore / purge / empty drops the row from every loaded filter.
 */
import { randomUUID } from 'node:crypto';

import type { TrashItem, TrashListParams, TrashProjectFilter } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { trashService } from '@/services/trash';

import type { TrashListData } from './initialState';
import { initialState } from './initialState';
import { trashCountKey, trashCountResource, trashListKey, trashListResource } from './projection';
import { trashSelectors } from './selectors';
import { useTrashStore } from './store';

vi.mock('@/services/trash', () => ({
  trashService: {
    countByType: vi.fn(),
    emptyTrash: vi.fn(),
    list: vi.fn(),
    purge: vi.fn(),
    restore: vi.fn(),
  },
}));

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

const item = (
  id: string,
  title = id,
  resourceType: TrashItem['resourceType'] = 'topic',
): TrashItem =>
  ({
    deletedAt: new Date('2026-08-01T00:00:00Z'),
    deletedByUserId: 'u1',
    expiresAt: new Date('2026-08-31T00:00:00Z'),
    id,
    meta: null,
    resourceId: `res_${id}`,
    resourceType,
    rootId: null,
    title,
    userId: 'u1',
    workspaceId: null,
  }) as TrashItem;

/** A persisted paged view as `toPersistedPage` writes it. */
const paged = (items: TrashItem[], nextCursor: string | null = null): TrashListData => ({
  currentPage: 0,
  hasMore: nextCursor !== null,
  items,
  nextCursor,
  pageSize: items.length,
  pages: [{ count: items.length, next: nextCursor }],
});

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

/** Route `trashService.list` by the requested filter. */
const listFor = (
  byType: (
    resourceType: TrashItem['resourceType'] | undefined,
    projectId: TrashProjectFilter,
  ) => {
    items: TrashItem[];
    nextCursor: string | null;
  },
) =>
  vi
    .mocked(trashService.list)
    .mockImplementation(async (params?: Omit<TrashListParams, 'deletedByUserId'>) =>
      byType(params?.resourceType, params?.projectId),
    );

const itemIds = (resourceType?: TrashItem['resourceType'], projectId?: TrashProjectFilter) =>
  useTrashStore
    .getState()
    .trashListMap[trashListKey({ projectId, resourceType })]?.items.map((i) => i.id);

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('trash replicas', () => {
  const scopes = new Set<string>();
  let scope = '';
  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  const storageKeyOf = (resourceType?: TrashItem['resourceType']) =>
    trashListResource.storageKey({ resourceType });
  const projectKeys: TrashProjectFilter[] = [undefined, null, 'proj_a', 'proj_b'];

  beforeEach(() => {
    useScope(`trash-user-${randomUUID()}:personal`);
    act(() => useTrashStore.setState({ ...initialState }));
    vi.clearAllMocks();
    vi.mocked(trashService.countByType).mockResolvedValue({});
  });

  afterEach(async () => {
    await Promise.all(
      [...scopes].flatMap((value) =>
        projectKeys.flatMap((projectId) => [
          trashListResource.storage!.remove({
            queryKey: trashListKey({ projectId }),
            scope: value,
          }),
          trashListResource.storage!.remove({
            queryKey: trashListKey({ projectId, resourceType: 'topic' }),
            scope: value,
          }),
          trashCountResource.storage!.remove({ queryKey: trashCountKey(projectId), scope: value }),
        ]),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted list before the network answers', async () => {
    await trashListResource.storage!.set(
      { queryKey: storageKeyOf(), scope },
      { data: paged([item('t1', 'Cached')]), updatedAt: 1 },
    );
    vi.mocked(trashService.list).mockImplementation(pending);

    const sync = renderHook(() => useTrashStore((s) => s.useFetchTrash)(true, {}), { wrapper });
    const list = renderHook(() => useTrashStore(trashSelectors.currentList({})));

    await waitFor(() => expect(list.result.current?.items.map((i) => i.title)).toEqual(['Cached']));
    expect(sync.result.current.isHydrated).toBe(true);
    expect(sync.result.current.isValidating).toBe(true);
  });

  it('replaces the list with the server response and persists it', async () => {
    vi.mocked(trashService.list).mockResolvedValue({
      items: [item('t1', 'Server')],
      nextCursor: null,
    });

    renderHook(() => useTrashStore((s) => s.useFetchTrash)(true, {}), { wrapper });

    await waitFor(() => expect(itemIds()).toEqual(['t1']));
    await waitFor(async () =>
      expect(
        (await trashListResource.storage!.get({ queryKey: storageKeyOf(), scope }))?.data.items[0]
          ?.title,
      ).toBe('Server'),
    );
  });

  it('keys each type filter as its own view', async () => {
    listFor((resourceType) =>
      resourceType === 'topic'
        ? { items: [item('topic_1', 'A topic', 'topic')], nextCursor: null }
        : { items: [item('agent_1', 'An agent', 'agent')], nextCursor: null },
    );

    renderHook(() => useTrashStore((s) => s.useFetchTrash)(true, { resourceType: 'topic' }), {
      wrapper,
    });
    renderHook(() => useTrashStore((s) => s.useFetchTrash)(true, {}), { wrapper });

    await waitFor(() => expect(itemIds('topic')).toEqual(['topic_1']));
    await waitFor(() => expect(itemIds()).toEqual(['agent_1']));
  });

  it('appends the next cursor page on loadMore', async () => {
    vi.mocked(trashService.list)
      .mockResolvedValueOnce({ items: [item('t1'), item('t2')], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [item('t3')], nextCursor: null });

    renderHook(() => useTrashStore((s) => s.useFetchTrash)(true, {}), { wrapper });
    await waitFor(() =>
      expect(useTrashStore.getState().trashListMap[trashListKey()]?.nextCursor).toBe('cursor-1'),
    );

    await act(() => useTrashStore.getState().loadMore({}));

    expect(trashService.list).toHaveBeenLastCalledWith({
      cursor: 'cursor-1',
      projectId: undefined,
      resourceType: undefined,
    });
    expect(itemIds()).toEqual(['t1', 't2', 't3']);
    expect(useTrashStore.getState().trashListMap[trashListKey()]?.nextCursor).toBeNull();
  });

  it('drops a restored row from the loaded view', async () => {
    vi.mocked(trashService.list).mockResolvedValue({
      items: [item('t1'), item('t2')],
      nextCursor: null,
    });
    renderHook(() => useTrashStore((s) => s.useFetchTrash)(true, {}), { wrapper });
    await waitFor(() => expect(itemIds()).toEqual(['t1', 't2']));

    vi.mocked(trashService.restore).mockResolvedValue({ failed: [], restored: [item('t1')] });
    // The follow-up refresh sees the server's post-restore list.
    vi.mocked(trashService.list).mockResolvedValue({ items: [item('t2')], nextCursor: null });

    await act(() => useTrashStore.getState().restore(['t1']));

    expect(itemIds()).toEqual(['t2']);
    expect(useTrashStore.getState().loadingIds).toEqual([]);
  });

  it('drops restored rows from every loaded filter', async () => {
    listFor((resourceType) =>
      resourceType === 'topic'
        ? { items: [item('shared_1', 'A topic'), item('topic_2')], nextCursor: null }
        : {
            items: [item('shared_1', 'A topic'), item('agent_1', 'An agent', 'agent')],
            nextCursor: null,
          },
    );

    renderHook(
      () => {
        useTrashStore((s) => s.useFetchTrash)(true, { resourceType: 'topic' });
        useTrashStore((s) => s.useFetchTrash)(true, {});
      },
      { wrapper },
    );
    await waitFor(() => expect(itemIds('topic')).toEqual(['shared_1', 'topic_2']));
    await waitFor(() => expect(itemIds()).toEqual(['shared_1', 'agent_1']));

    vi.mocked(trashService.restore).mockResolvedValue({
      failed: [],
      restored: [item('shared_1', 'A topic')],
    });
    listFor((resourceType) =>
      resourceType === 'topic'
        ? { items: [item('topic_2')], nextCursor: null }
        : { items: [item('agent_1', 'An agent', 'agent')], nextCursor: null },
    );

    await act(() => useTrashStore.getState().restore(['shared_1']));

    expect(itemIds('topic')).toEqual(['topic_2']);
    expect(itemIds()).toEqual(['agent_1']);
  });

  it('emptyTrash collapses the active filter’s view', async () => {
    vi.mocked(trashService.list).mockResolvedValue({
      items: [item('t1', 'A topic', 'topic')],
      nextCursor: null,
    });
    act(() => useTrashStore.setState({ activeType: 'topic' }));
    renderHook(() => useTrashStore((s) => s.useFetchTrash)(true, { resourceType: 'topic' }), {
      wrapper,
    });
    await waitFor(() => expect(itemIds('topic')).toEqual(['t1']));

    vi.mocked(trashService.emptyTrash).mockResolvedValue({ hasMore: false, purged: 1 });
    vi.mocked(trashService.list).mockResolvedValue({ items: [], nextCursor: null });

    await act(() => useTrashStore.getState().emptyTrash({ resourceType: 'topic' }));

    expect(trashService.emptyTrash).toHaveBeenCalledWith({ resourceType: 'topic' }, null);
    expect(itemIds('topic')).toEqual([]);
  });

  it('never hydrates another identity’s persisted list', async () => {
    const other = `trash-user-${randomUUID()}:personal`;
    scopes.add(other);
    await trashListResource.storage!.set(
      { queryKey: storageKeyOf(), scope: other },
      { data: paged([item('stale', 'Other user')]), updatedAt: 1 },
    );
    vi.mocked(trashService.list).mockImplementation(pending);

    renderHook(() => useTrashStore((s) => s.useFetchTrash)(true, {}), { wrapper });

    // Give hydration a chance to (wrongly) land, then assert the view is empty.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(useTrashStore.getState().trashListMap[trashListKey()]).toBeUndefined();
  });

  it('drops the previous identity’s list before the next one paints', async () => {
    vi.mocked(trashService.list).mockResolvedValue({
      items: [item('t1', 'Mine')],
      nextCursor: null,
    });
    const sync = renderHook(() => useTrashStore((s) => s.useFetchTrash)(true, {}), { wrapper });
    await waitFor(() => expect(itemIds()).toEqual(['t1']));

    vi.mocked(trashService.list).mockImplementation(pending);
    useScope(`trash-user-${randomUUID()}:personal`);
    sync.rerender();

    await waitFor(() =>
      expect(useTrashStore.getState().trashListMap[trashListKey()]).toBeUndefined(),
    );
  });

  it('keys every project filter as its own view and asks the server for it', async () => {
    listFor((_, projectId) => ({
      items: [item(projectId === undefined ? 'all' : projectId === null ? 'none' : projectId)],
      nextCursor: null,
    }));

    renderHook(
      () => {
        useTrashStore((s) => s.useFetchTrash)(true, {});
        useTrashStore((s) => s.useFetchTrash)(true, { projectId: null });
        useTrashStore((s) => s.useFetchTrash)(true, { projectId: 'proj_a' });
      },
      { wrapper },
    );

    await waitFor(() => expect(itemIds(undefined, 'proj_a')).toEqual(['proj_a']));
    expect(itemIds(undefined, null)).toEqual(['none']);
    expect(itemIds()).toEqual(['all']);
    expect(vi.mocked(trashService.list).mock.calls.map(([params]) => params?.projectId)).toEqual(
      expect.arrayContaining([undefined, null, 'proj_a']),
    );
  });

  it('a late response for the previous project never repaints the current one', async () => {
    const slow = deferred<{ items: TrashItem[]; nextCursor: string | null }>();
    listFor((_, projectId) =>
      projectId === 'proj_a' ? (slow.promise as never) : { items: [item('b1')], nextCursor: null },
    );

    const { rerender } = renderHook(
      ({ projectId }: { projectId: TrashProjectFilter }) =>
        useTrashStore((s) => s.useFetchTrash)(true, { projectId }),
      { initialProps: { projectId: 'proj_a' as TrashProjectFilter }, wrapper },
    );
    rerender({ projectId: 'proj_b' });
    await waitFor(() => expect(itemIds(undefined, 'proj_b')).toEqual(['b1']));

    await act(async () => {
      slow.resolve({ items: [item('a1')], nextCursor: null });
      await slow.promise;
    });

    // The late page belongs to project A's own entry; B's view is untouched.
    expect(itemIds(undefined, 'proj_b')).toEqual(['b1']);
    expect(itemIds(undefined, 'proj_a') ?? []).not.toContain('b1');
  });

  describe('selectors', () => {
    it('totalCount sums the per-type counts of one project filter', async () => {
      vi.mocked(trashService.countByType).mockImplementation(async (projectId) =>
        projectId === 'proj_a' ? { topic: 4 } : { agent: 1, topic: 2 },
      );
      renderHook(
        () => {
          useTrashStore((s) => s.useFetchTrashCount)(true);
          useTrashStore((s) => s.useFetchTrashCount)(true, 'proj_a');
        },
        { wrapper },
      );

      await waitFor(() =>
        expect(useTrashStore.getState().trashCountMap[trashCountKey()]).toEqual({
          agent: 1,
          topic: 2,
        }),
      );
      await waitFor(() =>
        expect(useTrashStore.getState().trashCountMap[trashCountKey('proj_a')]).toEqual({
          topic: 4,
        }),
      );
      const state = useTrashStore.getState();
      expect(trashSelectors.totalCount()(state)).toBe(3);
      expect(trashSelectors.countByType()(state)).toEqual({ agent: 1, topic: 2 });
      expect(trashSelectors.filterCount({ projectId: 'proj_a' })(state)).toBe(4);
      expect(
        trashSelectors.filterCount({ projectId: 'proj_a', resourceType: 'agent' })(state),
      ).toBe(0);
      // Not loaded yet: unknown, never a confident zero.
      expect(trashSelectors.filterCount({ projectId: null })(state)).toBeUndefined();
    });
  });
});
