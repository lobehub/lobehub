/**
 * @vitest-environment happy-dom
 *
 * Recents are a replica: the sidebar paints the persisted rows on the first
 * frame, and a rename shows at once in every loaded recents query.
 */
import { randomUUID } from 'node:crypto';

import type { RecentItem } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { RECENT_SIDEBAR_TYPES, recentService } from '@/services/recent';
import { taskService } from '@/services/task';
import { useHomeStore } from '@/store/home';
import { createRecentQueryKey, initialRecentState } from '@/store/home/slices/recent/initialState';
import { recentListResource } from '@/store/home/slices/recent/projection';
import { homeRecentSelectors } from '@/store/home/slices/recent/selectors';

const item = (id: string, title: string, type: RecentItem['type'] = 'task'): RecentItem => ({
  icon: type,
  id,
  routePath: '/',
  status: null,
  title,
  type,
  updatedAt: new Date(0),
});

type TaskUpdateResult = Awaited<ReturnType<typeof taskService.update>>;
const taskUpdateResult = {} as TaskUpdateResult;

const deferred = <T>() => {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
};

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

const SIDEBAR = createRecentQueryKey(11);
const DRAWER = createRecentQueryKey(50);
const titleOf = (queryKey: string, ref: `${RecentItem['type']}:${string}`) =>
  homeRecentSelectors.item(queryKey, ref)(useHomeStore.getState())?.title;

let scope = '';
const useScope = (next: string) => {
  scope = next;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
};

/** Load the sidebar (10 + 1 rows) and, optionally, the drawer through the real sync path. */
const load = async (sidebar: RecentItem[], drawer?: RecentItem[]) => {
  vi.spyOn(recentService, 'getAll').mockImplementation(async (limit) =>
    limit === 50 ? (drawer ?? []) : sidebar,
  );
  renderHook(
    () => {
      useHomeStore((s) => s.useFetchRecents)(true, 10);
      useHomeStore((s) => s.useFetchAllRecents)(!!drawer);
    },
    { wrapper },
  );
  await waitFor(() => {
    expect(useHomeStore.getState().recentListMap[SIDEBAR]).toBeDefined();
    if (drawer) expect(useHomeStore.getState().recentListMap[DRAWER]).toBeDefined();
  });
};

beforeEach(() => {
  useScope(`recent-user-${randomUUID()}:personal`);
  act(() => useHomeStore.setState({ ...initialRecentState }));
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('recents replica', () => {
  it('paints the persisted rows before the network answers', async () => {
    await recentListResource.storage!.set(
      { queryKey: recentListResource.storageKey({ limit: 11, types: RECENT_SIDEBAR_TYPES }), scope },
      { data: [item('a', 'Cached')], updatedAt: 1 },
    );
    vi.spyOn(recentService, 'getAll').mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() => useHomeStore((s) => s.useFetchRecents)(true, 10), {
      wrapper,
    });

    await waitFor(() => expect(titleOf(SIDEBAR, 'task:a')).toBe('Cached'));
    expect(result.current.isValidating).toBe(true);
  });

  it('does not fetch while logged out', () => {
    const getAll = vi.spyOn(recentService, 'getAll');
    renderHook(() => useHomeStore((s) => s.useFetchRecents)(false, 10), { wrapper });
    expect(getAll).not.toHaveBeenCalled();
  });
  it('scopes the sidebar fetch to the selected entity types', async () => {
    const getAll = vi.spyOn(recentService, 'getAll').mockResolvedValue([]);

    renderHook(() => useHomeStore((s) => s.useFetchRecents)(true, 10, ['topic']), { wrapper });

    await waitFor(() => expect(getAll).toHaveBeenCalledWith(11, ['topic']));
  });


  it('shows an optimistic title and rolls it back when persistence fails', async () => {
    await load([item('a', 'Old')]);
    const request = deferred<TaskUpdateResult>();
    vi.spyOn(taskService, 'update').mockReturnValue(request.promise);

    const renamePromise = useHomeStore
      .getState()
      .renameRecent({ id: 'a', title: 'Draft', type: 'task' });
    expect(titleOf(SIDEBAR, 'task:a')).toBe('Draft');

    request.reject(new Error('failed'));
    await expect(renamePromise).rejects.toThrow('failed');
    expect(titleOf(SIDEBAR, 'task:a')).toBe('Old');
  });

  it('renames the entity in every loaded query, not same-id rows of other types', async () => {
    await load(
      [item('same', 'Task')],
      [item('same', 'Task'), item('same', 'Document', 'document')],
    );
    vi.spyOn(taskService, 'update').mockResolvedValue(taskUpdateResult);

    await act(() =>
      useHomeStore.getState().renameRecent({ id: 'same', title: 'Renamed', type: 'task' }),
    );

    expect(titleOf(SIDEBAR, 'task:same')).toBe('Renamed');
    expect(titleOf(DRAWER, 'task:same')).toBe('Renamed');
    expect(titleOf(DRAWER, 'document:same')).toBe('Document');
  });

  it('carries the slug source with a task rename', async () => {
    await load([item('a', 'Old')]);
    vi.spyOn(taskService, 'update').mockResolvedValue(taskUpdateResult);

    await act(() => useHomeStore.getState().renameRecent({ id: 'a', title: 'New', type: 'task' }));

    expect(homeRecentSelectors.item(SIDEBAR, 'task:a')(useHomeStore.getState())).toMatchObject({
      slugTitle: 'New',
      title: 'New',
    });
  });

  it('serializes repeated renames and keeps the latest optimistic title', async () => {
    await load([item('a', 'Old')]);
    const firstRequest = deferred<TaskUpdateResult>();
    const secondRequest = deferred<TaskUpdateResult>();
    const updateSpy = vi
      .spyOn(taskService, 'update')
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);

    const firstRename = useHomeStore
      .getState()
      .renameRecent({ id: 'a', title: 'First', type: 'task' });
    const secondRename = useHomeStore
      .getState()
      .renameRecent({ id: 'a', title: 'Second', type: 'task' });

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(titleOf(SIDEBAR, 'task:a')).toBe('Second');

    firstRequest.resolve(taskUpdateResult);
    await firstRename;
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(2));
    expect(titleOf(SIDEBAR, 'task:a')).toBe('Second');

    secondRequest.resolve(taskUpdateResult);
    await secondRename;
    expect(titleOf(SIDEBAR, 'task:a')).toBe('Second');
  });

  it('keeps a newer pending rename when an older one fails', async () => {
    await load([item('a', 'Old')]);
    const firstRequest = deferred<TaskUpdateResult>();
    const secondRequest = deferred<TaskUpdateResult>();
    vi.spyOn(taskService, 'update')
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);

    const firstRename = useHomeStore
      .getState()
      .renameRecent({ id: 'a', title: 'First', type: 'task' });
    const secondRename = useHomeStore
      .getState()
      .renameRecent({ id: 'a', title: 'Second', type: 'task' });

    firstRequest.reject(new Error('failed'));
    await expect(firstRename).rejects.toThrow('failed');
    expect(titleOf(SIDEBAR, 'task:a')).toBe('Second');

    secondRequest.resolve(taskUpdateResult);
    await secondRename;
  });
});
