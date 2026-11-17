import { useEffect, useRef } from 'react';

import { useHomeStore } from '@/store/home';
import { favoriteSelectors } from '@/store/home/selectors';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

/**
 * Refresh the favorites once a favorited task's page closes. While the page is
 * open its row follows the live detail; after it closes the row falls back to
 * the listed status, which must then include any change made on the page.
 */
export const useRefreshOnTaskLeave = () => {
  const activeTaskId = useTaskStore(taskDetailSelectors.activeTaskDatabaseId);
  const refreshFavorites = useHomeStore((s) => s.refreshFavorites);
  const previous = useRef(activeTaskId);

  useEffect(() => {
    const left = previous.current;
    previous.current = activeTaskId;
    if (!left || left === activeTaskId) return;
    if (!favoriteSelectors.isFavorite('task', left)(useHomeStore.getState())) return;

    refreshFavorites().catch((error) => {
      console.error('[favorite] refresh after leaving a task failed', error);
    });
  }, [activeTaskId, refreshFavorites]);
};
