/**
 * @vitest-environment happy-dom
 *
 * The user-memory activity list is a `@lobechat/replica` paged resource: the
 * persisted head page paints before the network answers, the response confirms
 * and persists it, "load more" appends through the engine, a query change
 * repaints from its own head page instead of appending to the previous search,
 * and a delete drops the row from the view and the persisted projection.
 */
import { randomUUID } from 'node:crypto';

import { type ActivityListItem, type ActivityListResult } from '@lobechat/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { memoryCRUDService, userMemoryService } from '@/services/userMemory';

import { initialState } from '../../initialState';
import { useUserMemoryStore } from '../../store';
import {
  ACTIVITY_LIST_KEY,
  type ActivityListData,
  type ActivityListParams,
  activityListResource,
} from './projection';

const BASE_PARAMS: ActivityListParams = { pageSize: 12 };
const SEARCH_PARAMS: ActivityListParams = { pageSize: 12, q: 'foo' };
const BASE_KEY = activityListResource.storageKey(BASE_PARAMS);
const SEARCH_KEY = activityListResource.storageKey(SEARCH_PARAMS);

const item = (id: string): ActivityListItem => ({ id, title: id }) as ActivityListItem;

const ids = (data?: ActivityListData) => data?.items.map((entry) => entry.id);

const idsOf = (length: number, offset = 0) =>
  Array.from({ length }, (_, i) => item(`activity-${i + offset}`));

const listPage = (items: ActivityListItem[], total: number): ActivityListResult => ({
  items,
  page: 1,
  pageSize: 12,
  total,
});

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

describe('activityList replica', () => {
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
    useScope(`activity-user-${randomUUID()}:personal`);
    fetchSpy = vi.spyOn(userMemoryService, 'queryActivities');
    act(() => useUserMemoryStore.setState(initialState, false));
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].flatMap((value) =>
        [BASE_KEY, SEARCH_KEY].map((queryKey) =>
          activityListResource.storage!.remove({ queryKey, scope: value }),
        ),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('reads the list from a single scope entry', () => {
    expect(ACTIVITY_LIST_KEY).toBe('all');
  });

  it('paints the persisted head page before the network answers', async () => {
    const cached: ActivityListData = {
      currentPage: 0,
      hasMore: true,
      items: [item('cached-1')],
      pageSize: 12,
      total: 24,
    };
    await activityListResource.storage!.set(
      { queryKey: BASE_KEY, scope },
      { data: cached, updatedAt: 1 },
    );
    fetchSpy.mockImplementation(pending);

    renderHook(() => useUserMemoryStore((s) => s.useFetchActivities)({ pageSize: 12 }), {
      wrapper,
    });

    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().activityListData)).toEqual(['cached-1']),
    );
    // The flat mirror paints the persisted rows too.
    expect(useUserMemoryStore.getState().activities.map((a) => a.id)).toEqual(['cached-1']);
    expect(useUserMemoryStore.getState().activitiesInit).toBe(true);
  });

  it('replaces the head page with the server response and persists it', async () => {
    fetchSpy.mockResolvedValue(listPage([item('a'), item('b')], 24));

    renderHook(() => useUserMemoryStore((s) => s.useFetchActivities)({ pageSize: 12 }), {
      wrapper,
    });

    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().activityListData)).toEqual(['a', 'b']),
    );
    expect(useUserMemoryStore.getState().activities.map((a) => a.id)).toEqual(['a', 'b']);
    expect(useUserMemoryStore.getState().activitiesTotal).toBe(24);
    expect(useUserMemoryStore.getState().activitiesHasMore).toBe(true);

    await waitFor(async () => {
      const row = await activityListResource.storage!.get({ queryKey: BASE_KEY, scope });
      expect(ids(row?.data as ActivityListData)).toEqual(['a', 'b']);
    });
  });

  it('appends the next page with the loaded query params', async () => {
    fetchSpy
      .mockResolvedValueOnce(listPage(idsOf(12), 24))
      .mockResolvedValueOnce(listPage(idsOf(12, 12), 24));

    const hook = renderHook(
      () => ({
        loadMore: useUserMemoryStore((s) => s.loadMoreActivities),
        sync: useUserMemoryStore((s) => s.useFetchActivities)({ pageSize: 12 }),
      }),
      { wrapper },
    );

    await waitFor(() => expect(useUserMemoryStore.getState().activities).toHaveLength(12));

    await act(async () => {
      hook.result.current.loadMore();
    });

    await waitFor(() => expect(useUserMemoryStore.getState().activities).toHaveLength(24));
    const list = useUserMemoryStore.getState().activityListData!;
    expect(list.currentPage).toBe(1);
    expect(list.items[12].id).toBe('activity-12');
    expect(list.hasMore).toBe(false);
    // The replica owns the cursor: page 2 of the loaded query.
    expect(fetchSpy).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: 12 }));
  });

  it('repaints from its own head page when the query changes', async () => {
    fetchSpy
      .mockResolvedValueOnce(listPage(idsOf(12), 24))
      .mockResolvedValueOnce(listPage(idsOf(12, 12), 24))
      .mockResolvedValueOnce(listPage([item('foo-1')], 1));

    const hook = renderHook(
      (props: { q?: string }) =>
        useUserMemoryStore((s) => s.useFetchActivities)({ pageSize: 12, q: props.q }),
      { initialProps: {} as { q?: string }, wrapper },
    );

    await waitFor(() => expect(useUserMemoryStore.getState().activities).toHaveLength(12));
    act(() => {
      useUserMemoryStore.getState().loadMoreActivities();
    });
    await waitFor(() => expect(useUserMemoryStore.getState().activities).toHaveLength(24));

    hook.rerender({ q: 'foo' });

    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().activityListData)).toEqual(['foo-1']),
    );
    // A different query resets the loaded depth; it never merges into the previous search.
    expect(useUserMemoryStore.getState().activityListData).toMatchObject({
      currentPage: 0,
      q: 'foo',
      total: 1,
    });
  });

  it('keeps the newest query when a superseded search resolves last', async () => {
    const pendingByQuery = new Map<string, (value: ActivityListResult) => void>();
    fetchSpy.mockImplementation(
      (params: { q?: string } = {}) =>
        new Promise<ActivityListResult>((resolve) => pendingByQuery.set(params.q ?? '', resolve)),
    );

    const hook = renderHook(
      (props: { q?: string }) =>
        useUserMemoryStore((s) => s.useFetchActivities)({ pageSize: 12, q: props.q }),
      { initialProps: {} as { q?: string }, wrapper },
    );

    hook.rerender({ q: 'foo' });
    await waitFor(() => expect(pendingByQuery.has('foo')).toBe(true));

    await act(async () => {
      pendingByQuery.get('foo')!(listPage([item('foo-1')], 1));
    });
    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().activityListData)).toEqual(['foo-1']),
    );

    // The superseded head request settles late and must not repaint the view.
    await act(async () => {
      pendingByQuery.get('')!(listPage(idsOf(12), 24));
    });

    expect(ids(useUserMemoryStore.getState().activityListData)).toEqual(['foo-1']);
  });

  it('drops the painted page set on reset but keeps the persisted row', async () => {
    fetchSpy.mockResolvedValue(listPage([item('a')], 1));

    renderHook(() => useUserMemoryStore((s) => s.useFetchActivities)({ pageSize: 12 }), {
      wrapper,
    });

    await waitFor(() => expect(ids(useUserMemoryStore.getState().activityListData)).toEqual(['a']));
    await waitFor(async () =>
      expect(
        (await activityListResource.storage!.get({ queryKey: BASE_KEY, scope }))?.data,
      ).toBeDefined(),
    );

    act(() => useUserMemoryStore.getState().resetActivitiesList({ q: 'gone' }));

    expect(useUserMemoryStore.getState().activityListData).toBeUndefined();
    expect(useUserMemoryStore.getState().activities).toEqual([]);
    expect(useUserMemoryStore.getState().activitiesSearchLoading).toBe(true);
    const row = await activityListResource.storage!.get({ queryKey: BASE_KEY, scope });
    expect(ids(row?.data as ActivityListData)).toEqual(['a']);
  });

  it('drops a deleted activity from the view and the persisted row', async () => {
    fetchSpy.mockResolvedValue(listPage([item('a'), item('b')], 2));
    vi.spyOn(memoryCRUDService, 'deleteActivity').mockResolvedValue(undefined as never);

    renderHook(() => useUserMemoryStore((s) => s.useFetchActivities)({ pageSize: 12 }), {
      wrapper,
    });
    await waitFor(() =>
      expect(ids(useUserMemoryStore.getState().activityListData)).toEqual(['a', 'b']),
    );

    await act(async () => {
      await useUserMemoryStore.getState().deleteActivity('a');
    });

    await waitFor(() => expect(ids(useUserMemoryStore.getState().activityListData)).toEqual(['b']));
    expect(useUserMemoryStore.getState().activities.map((a) => a.id)).toEqual(['b']);

    await waitFor(async () => {
      const row = await activityListResource.storage!.get({ queryKey: BASE_KEY, scope });
      expect(ids(row?.data as ActivityListData)).toEqual(['b']);
    });
  });

  it('does not fetch another page when the head page is the last one', async () => {
    fetchSpy.mockResolvedValue(listPage([item('only')], 1));

    renderHook(() => useUserMemoryStore((s) => s.useFetchActivities)({ pageSize: 12 }), {
      wrapper,
    });

    await waitFor(() => expect(useUserMemoryStore.getState().activities).toHaveLength(1));
    expect(useUserMemoryStore.getState().activitiesHasMore).toBe(false);

    act(() => {
      useUserMemoryStore.getState().loadMoreActivities();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
