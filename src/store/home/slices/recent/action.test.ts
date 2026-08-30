import type { RecentItem } from '@lobechat/types';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as swr from '@/libs/swr';
import { recentKeys } from '@/libs/swr/keys';
import * as cacheScope from '@/libs/swr/useCacheScope';
import { taskService } from '@/services/task';
import { useHomeStore } from '@/store/home';
import { createRecentQueryKey, initialRecentState } from '@/store/home/slices/recent/initialState';
import { recentQueryRepository } from '@/store/home/slices/recent/repository';
import { homeRecentSelectors } from '@/store/home/slices/recent/selectors';

const item = (id: string, title: string, type: RecentItem['type'] = 'task'): RecentItem =>
  ({ id, title, type }) as RecentItem;

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

const replaceQuery = (scope: string, queryKey: string, items: RecentItem[]) =>
  useHomeStore.getState().internal_replaceRecentQuery(scope, queryKey, items);

beforeEach(() => {
  useHomeStore.setState({ ...initialRecentState });
  vi.spyOn(cacheScope, 'getCacheScope').mockReturnValue('user-1:ws-A');
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('RecentActionImpl', () => {
  it('keeps list projections isolated by scope and query', () => {
    const compactQuery = createRecentQueryKey(11);
    const drawerQuery = createRecentQueryKey(50);

    act(() => {
      replaceQuery('user-1:ws-A', compactQuery, [item('a', 'Compact')]);
      replaceQuery('user-1:ws-A', drawerQuery, [item('a', 'Drawer'), item('b', 'B')]);
    });

    expect(
      homeRecentSelectors.query('user-1:ws-A', compactQuery)(useHomeStore.getState())?.items,
    ).toEqual([item('a', 'Compact')]);
    expect(
      homeRecentSelectors.query('user-1:ws-A', drawerQuery)(useHomeStore.getState())?.items,
    ).toEqual([item('a', 'Drawer'), item('b', 'B')]);
  });

  it('ignores a query update after the active cache scope changed', () => {
    act(() => replaceQuery('user-1:ws-B', createRecentQueryKey(11), [item('stale', 'STALE')]));
    expect(useHomeStore.getState().recentsByScope['user-1:ws-B']).toBeUndefined();
  });

  it('hydrates only the requested query projection from the local repository', async () => {
    const queryKey = createRecentQueryKey(11);
    vi.spyOn(recentQueryRepository, 'get').mockResolvedValue({
      items: [item('cached', 'Cached')],
      updatedAt: 1,
      version: 1,
    });

    await act(() => useHomeStore.getState().hydrateRecentQuery('user-1:ws-A', queryKey));

    expect(recentQueryRepository.get).toHaveBeenCalledWith('user-1:ws-A', queryKey);
    expect(
      homeRecentSelectors.query('user-1:ws-A', queryKey)(useHomeStore.getState())?.items,
    ).toEqual([item('cached', 'Cached')]);
  });

  it('shows an optimistic title and rolls it back when persistence fails', async () => {
    const queryKey = createRecentQueryKey(11);
    const request = deferred<TaskUpdateResult>();
    vi.spyOn(taskService, 'update').mockReturnValue(request.promise);
    act(() => replaceQuery('user-1:ws-A', queryKey, [item('a', 'Old')]));

    const renamePromise = useHomeStore
      .getState()
      .renameRecent({ id: 'a', scope: 'user-1:ws-A', title: 'Draft', type: 'task' });
    expect(
      homeRecentSelectors.item('user-1:ws-A', queryKey, 'task:a')(useHomeStore.getState())?.title,
    ).toBe('Draft');

    await Promise.resolve();
    request.reject(new Error('failed'));
    await expect(renamePromise).rejects.toThrow('failed');
    expect(
      homeRecentSelectors.item('user-1:ws-A', queryKey, 'task:a')(useHomeStore.getState())?.title,
    ).toBe('Old');
  });

  it('fans a confirmed rename out to every loaded query projection', async () => {
    const compactQuery = createRecentQueryKey(11);
    const drawerQuery = createRecentQueryKey(50);
    vi.spyOn(taskService, 'update').mockResolvedValue(taskUpdateResult);
    vi.spyOn(recentQueryRepository, 'set').mockResolvedValue();
    act(() => {
      replaceQuery('user-1:ws-A', compactQuery, [item('same', 'Task', 'task')]);
      replaceQuery('user-1:ws-A', drawerQuery, [
        item('same', 'Task', 'task'),
        item('same', 'Document', 'document'),
      ]);
    });

    await useHomeStore
      .getState()
      .renameRecent({ id: 'same', scope: 'user-1:ws-A', title: 'Renamed', type: 'task' });

    expect(
      homeRecentSelectors.item('user-1:ws-A', compactQuery, 'task:same')(useHomeStore.getState())
        ?.title,
    ).toBe('Renamed');
    expect(
      homeRecentSelectors.item('user-1:ws-A', drawerQuery, 'task:same')(useHomeStore.getState())
        ?.title,
    ).toBe('Renamed');
    expect(
      homeRecentSelectors.item('user-1:ws-A', drawerQuery, 'document:same')(useHomeStore.getState())
        ?.title,
    ).toBe('Document');
  });

  it('serializes repeated renames and keeps the latest optimistic title', async () => {
    const queryKey = createRecentQueryKey(11);
    const firstRequest = deferred<TaskUpdateResult>();
    const secondRequest = deferred<TaskUpdateResult>();
    const updateSpy = vi
      .spyOn(taskService, 'update')
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    vi.spyOn(recentQueryRepository, 'set').mockResolvedValue();
    act(() => replaceQuery('user-1:ws-A', queryKey, [item('a', 'Old')]));

    const firstRename = useHomeStore
      .getState()
      .renameRecent({ id: 'a', scope: 'user-1:ws-A', title: 'First', type: 'task' });
    const secondRename = useHomeStore
      .getState()
      .renameRecent({ id: 'a', scope: 'user-1:ws-A', title: 'Second', type: 'task' });

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(
      homeRecentSelectors.item('user-1:ws-A', queryKey, 'task:a')(useHomeStore.getState())?.title,
    ).toBe('Second');

    firstRequest.resolve(taskUpdateResult);
    await firstRename;
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(2));
    expect(
      homeRecentSelectors.item('user-1:ws-A', queryKey, 'task:a')(useHomeStore.getState())?.title,
    ).toBe('Second');

    secondRequest.resolve(taskUpdateResult);
    await secondRename;
    expect(
      homeRecentSelectors.item('user-1:ws-A', queryKey, 'task:a')(useHomeStore.getState())?.title,
    ).toBe('Second');
  });

  it('revalidates both list surfaces only in the requested scope', async () => {
    const mutateSpy = vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as never);

    await act(() => useHomeStore.getState().refreshRecents('user-1:ws-A'));

    expect(mutateSpy).toHaveBeenCalledTimes(2);
    const matcher = mutateSpy.mock.calls[0][0] as (key: unknown) => boolean;
    expect(matcher(recentKeys.list(true, 10, 'user-1:ws-A'))).toBe(true);
    expect(matcher(recentKeys.list(true, 10, 'user-1:ws-B'))).toBe(false);
  });
});
