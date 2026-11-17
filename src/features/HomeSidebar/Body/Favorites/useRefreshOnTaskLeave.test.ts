/**
 * @vitest-environment happy-dom
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRefreshOnTaskLeave } from './useRefreshOnTaskLeave';

const state = vi.hoisted(() => ({
  activeTaskId: undefined as string | undefined,
  favoriteTaskIds: new Set<string>(),
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
    isFavorite: (_type: string, id: string) => () => state.favoriteTaskIds.has(id),
  },
}));

describe('useRefreshOnTaskLeave', () => {
  beforeEach(() => {
    state.activeTaskId = undefined;
    state.favoriteTaskIds = new Set(['task_fav']);
    state.refreshFavorites.mockClear();
  });

  it('refreshes the favorites when a favorited task page closes', () => {
    state.activeTaskId = 'task_fav';
    const { rerender } = renderHook(() => useRefreshOnTaskLeave());
    expect(state.refreshFavorites).not.toHaveBeenCalled();

    state.activeTaskId = undefined;
    rerender();

    expect(state.refreshFavorites).toHaveBeenCalledTimes(1);
  });

  it('leaves the favorites alone for a task that is not favorited', () => {
    state.activeTaskId = 'task_other';
    const { rerender } = renderHook(() => useRefreshOnTaskLeave());

    state.activeTaskId = undefined;
    rerender();

    expect(state.refreshFavorites).not.toHaveBeenCalled();
  });
});
