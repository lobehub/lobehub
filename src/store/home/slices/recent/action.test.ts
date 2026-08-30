import type { RecentItem } from '@lobechat/types';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as swr from '@/libs/swr';
import { recentKeys } from '@/libs/swr/keys';
import * as cacheScope from '@/libs/swr/useCacheScope';
import { taskService } from '@/services/task';
import { useHomeStore } from '@/store/home';
import { initialRecentState } from '@/store/home/slices/recent/initialState';
import { homeRecentSelectors } from '@/store/home/slices/recent/selectors';

const item = (id: string, title: string, type: RecentItem['type'] = 'task'): RecentItem =>
  ({ id, title, type }) as RecentItem;

type TaskUpdateResult = Awaited<ReturnType<typeof taskService.update>>;
const taskUpdateResult = {} as TaskUpdateResult;

const deferred = <T = void>() => {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
};

beforeEach(() => {
  useHomeStore.setState({ ...initialRecentState });
  vi.spyOn(cacheScope, 'getCacheScope').mockReturnValue('user-1:ws-A');
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('RecentActionImpl', () => {
  it('normalizes server data into a scoped ordered index and entity map', () => {
    act(() => {
      useHomeStore
        .getState()
        .ingestRecents('user-1:ws-A', [item('a', 'A'), item('b', 'B')], 10, 100);
    });

    const state = useHomeStore.getState();
    expect(state.recentsByScope['user-1:ws-A']?.index).toEqual({
      limit: 10,
      observedAt: 100,
      refs: ['task:a', 'task:b'],
    });
    expect(state.recentsByScope['user-1:ws-A']?.entities['task:a']).toEqual(item('a', 'A'));
  });

  it('ignores a response after the active cache scope changed', () => {
    act(() => {
      useHomeStore.getState().ingestRecents('user-1:ws-B', [item('stale', 'STALE')], 10, 100);
    });

    expect(useHomeStore.getState().recentsByScope['user-1:ws-B']).toBeUndefined();
  });

  it('does not let an older response overwrite a newer index', () => {
    act(() => {
      const store = useHomeStore.getState();
      store.ingestRecents('user-1:ws-A', [item('new', 'New')], 10, 200);
      store.ingestRecents('user-1:ws-A', [item('old', 'Old')], 10, 100);
    });

    expect(useHomeStore.getState().recentsByScope['user-1:ws-A']?.index?.refs).toEqual([
      'task:new',
    ]);
  });

  it('preserves the tail when a smaller sidebar response follows a larger drawer response', () => {
    act(() => {
      const store = useHomeStore.getState();
      store.ingestRecents('user-1:ws-A', [item('a', 'A'), item('b', 'B'), item('c', 'C')], 50, 100);
      store.ingestRecents('user-1:ws-A', [item('a', 'A2')], 1, 200);
    });

    expect(useHomeStore.getState().recentsByScope['user-1:ws-A']?.index?.refs).toEqual([
      'task:a',
      'task:b',
      'task:c',
    ]);
  });

  it('shows an optimistic title and rolls it back when persistence fails', async () => {
    const request = deferred<TaskUpdateResult>();
    vi.spyOn(taskService, 'update').mockReturnValue(request.promise);

    act(() => {
      useHomeStore.getState().ingestRecents('user-1:ws-A', [item('a', 'Old')], 10, 100);
    });

    const renamePromise = useHomeStore
      .getState()
      .renameRecent({ id: 'a', scope: 'user-1:ws-A', title: 'Draft', type: 'task' });
    expect(
      homeRecentSelectors.entity('user-1:ws-A', 'task:a')(useHomeStore.getState())?.title,
    ).toBe('Draft');

    await Promise.resolve();
    request.reject(new Error('failed'));
    await expect(renamePromise).rejects.toThrow('failed');
    expect(
      homeRecentSelectors.entity('user-1:ws-A', 'task:a')(useHomeStore.getState())?.title,
    ).toBe('Old');
  });

  it('commits only the matching typed entity when ids collide', async () => {
    vi.spyOn(taskService, 'update').mockResolvedValue(taskUpdateResult);
    vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as never);

    act(() => {
      useHomeStore
        .getState()
        .ingestRecents(
          'user-1:ws-A',
          [item('same', 'Task', 'task'), item('same', 'Document', 'document')],
          10,
          100,
        );
    });
    await useHomeStore
      .getState()
      .renameRecent({ id: 'same', scope: 'user-1:ws-A', title: 'Renamed task', type: 'task' });

    const entities = useHomeStore.getState().recentsByScope['user-1:ws-A']?.entities;
    expect(entities?.['task:same']?.title).toBe('Renamed task');
    expect(entities?.['document:same']?.title).toBe('Document');
  });

  it('serializes repeated renames and keeps the latest optimistic title', async () => {
    const firstRequest = deferred<TaskUpdateResult>();
    const secondRequest = deferred<TaskUpdateResult>();
    const updateSpy = vi
      .spyOn(taskService, 'update')
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as never);
    useHomeStore.getState().ingestRecents('user-1:ws-A', [item('a', 'Old')], 10, 100);

    const firstRename = useHomeStore
      .getState()
      .renameRecent({ id: 'a', scope: 'user-1:ws-A', title: 'First', type: 'task' });
    const secondRename = useHomeStore
      .getState()
      .renameRecent({ id: 'a', scope: 'user-1:ws-A', title: 'Second', type: 'task' });

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(
      homeRecentSelectors.entity('user-1:ws-A', 'task:a')(useHomeStore.getState())?.title,
    ).toBe('Second');

    firstRequest.resolve(taskUpdateResult);
    await firstRename;
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(2));
    expect(
      homeRecentSelectors.entity('user-1:ws-A', 'task:a')(useHomeStore.getState())?.title,
    ).toBe('Second');

    secondRequest.resolve(taskUpdateResult);
    await secondRename;
    expect(
      homeRecentSelectors.entity('user-1:ws-A', 'task:a')(useHomeStore.getState())?.title,
    ).toBe('Second');
  });

  it('only mutates SWR caches in the renamed scope', async () => {
    vi.spyOn(taskService, 'update').mockResolvedValue(taskUpdateResult);
    const mutateSpy = vi.spyOn(swr, 'mutate').mockResolvedValue(undefined as never);
    useHomeStore.getState().ingestRecents('user-1:ws-A', [item('a', 'Old')], 10, 100);

    await useHomeStore
      .getState()
      .renameRecent({ id: 'a', scope: 'user-1:ws-A', title: 'New', type: 'task' });

    const listMatcher = mutateSpy.mock.calls[0][0] as (key: unknown) => boolean;
    expect(listMatcher(recentKeys.list(true, 10, 'user-1:ws-A'))).toBe(true);
    expect(listMatcher(recentKeys.list(true, 10, 'user-1:ws-B'))).toBe(false);
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
