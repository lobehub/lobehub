/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RUNNING_TASK_REFRESH_MS, useTaskFavoritesRefresh } from './useTaskFavoritesRefresh';

const state = vi.hoisted(() => ({
  activeTaskId: undefined as string | undefined,
  favoriteTaskIds: new Set<string>(),
  list: [] as { status?: string; type: string }[],
  refreshFavorites: vi.fn(async () => {}),
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/task/selectors', () => ({
  taskDetailSelectors: { activeTaskDatabaseId: () => state.activeTaskId },
}));
vi.mock('@/store/home', () => {
  const useHomeStore = (selector: (s: unknown) => unknown) =>
    selector({ refreshFavorites: state.refreshFavorites });
  useHomeStore.getState = () => ({});
  return { useHomeStore };
});
vi.mock('@/store/home/selectors', () => ({
  favoriteSelectors: {
    favoriteList: () => state.list,
    isFavorite: (_type: string, id: string) => () => state.favoriteTaskIds.has(id),
  },
}));

describe('useTaskFavoritesRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.activeTaskId = undefined;
    state.favoriteTaskIds = new Set(['task_fav']);
    state.list = [{ status: 'paused', type: 'task' }];
    state.refreshFavorites.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes the favorites when a favorited task page closes', () => {
    state.activeTaskId = 'task_fav';
    const { rerender } = renderHook(() => useTaskFavoritesRefresh());
    expect(state.refreshFavorites).not.toHaveBeenCalled();

    state.activeTaskId = undefined;
    rerender();

    expect(state.refreshFavorites).toHaveBeenCalledTimes(1);
  });

  it('leaves the favorites alone for a task that is not favorited', () => {
    state.activeTaskId = 'task_other';
    const { rerender } = renderHook(() => useTaskFavoritesRefresh());

    state.activeTaskId = undefined;
    rerender();

    expect(state.refreshFavorites).not.toHaveBeenCalled();
  });

  it('polls only while a favorited task is running', () => {
    const { rerender } = renderHook(() => useTaskFavoritesRefresh());
    vi.advanceTimersByTime(RUNNING_TASK_REFRESH_MS * 2);
    expect(state.refreshFavorites).not.toHaveBeenCalled();

    state.list = [{ status: 'running', type: 'task' }];
    rerender();
    vi.advanceTimersByTime(RUNNING_TASK_REFRESH_MS * 2);
    expect(state.refreshFavorites).toHaveBeenCalledTimes(2);

    // The run finished: the next list has no running task, so polling stops.
    state.list = [{ status: 'completed', type: 'task' }];
    rerender();
    vi.advanceTimersByTime(RUNNING_TASK_REFRESH_MS * 2);
    expect(state.refreshFavorites).toHaveBeenCalledTimes(2);
  });
});
