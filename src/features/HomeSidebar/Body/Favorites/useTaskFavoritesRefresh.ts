import { useEffect, useRef } from 'react';

import { useHomeStore } from '@/store/home';
import { favoriteSelectors } from '@/store/home/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

/** How often the list is refetched while a favorited task is running. */
export const RUNNING_TASK_REFRESH_MS = 30_000;

const refresh = (refreshFavorites: () => Promise<void>) => {
  refreshFavorites().catch((error) => {
    console.error('[favorite] failed to refresh task statuses', error);
  });
};

/**
 * Keep the listed status of task favorites current. While a task's page is
 * open its row follows the live detail; otherwise it shows the listed status,
 * so the list is refetched when a favorited task's page closes (to pick up a
 * change made there) and, while any favorited task is running, on an interval
 * that stops once none is (a run finishes in the background).
 */
export const useTaskFavoritesRefresh = () => {
  const activeTaskId = useTaskStore(taskDetailSelectors.activeTaskDatabaseId);
  const refreshFavorites = useHomeStore((s) => s.refreshFavorites);
  const hasRunningTask = useHomeStore(
    (s) =>
      favoriteSelectors
        .favoriteList(s)
        ?.some((item) => item.type === 'task' && item.status === 'running') ?? false,
  );
  const previous = useRef(activeTaskId);

  useEffect(() => {
    const left = previous.current;
    previous.current = activeTaskId;
    if (!left || left === activeTaskId) return;
    if (!favoriteSelectors.isFavorite('task', left)(useHomeStore.getState())) return;

    refresh(refreshFavorites);
  }, [activeTaskId, refreshFavorites]);

  useEffect(() => {
    if (!hasRunningTask) return;

    const timer = setInterval(() => {
      // A hidden tab refetches on focus anyway.
      if (document.visibilityState === 'visible') refresh(refreshFavorites);
    }, RUNNING_TASK_REFRESH_MS);

    return () => clearInterval(timer);
  }, [hasRunningTask, refreshFavorites]);
};
