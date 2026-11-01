import type { FavoriteTarget } from '@/features/Favorites';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { taskDetailPath } from '../shared/taskDetailPath';

/** The open task as a sidebar favorite, keyed by its database id so a renumbered link still matches. */
export const useTaskFavoriteTarget = (): FavoriteTarget | undefined => {
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const databaseId = useTaskStore(taskDetailSelectors.activeTaskDatabaseId);
  const agentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const name = useTaskStore(taskDetailSelectors.activeTaskName);

  if (!taskId || !databaseId) return undefined;

  // The database id arrives with the detail, so the name here is the task's own,
  // even when empty; an unnamed task is shown, and favorited, by its identifier.
  return {
    path: taskDetailPath(taskId, agentId ?? undefined, name),
    targetId: databaseId,
    title: name || taskId,
    type: 'task',
  };
};
