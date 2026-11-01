import { useMemo } from 'react';

import { useTaskStore } from '@/store/task';
import { taskListSelectors } from '@/store/task/selectors';
import type { TaskGroupItem } from '@/store/task/slices/list/initialState';

// The agent's status board (automated work included) without its finished
// columns: a task-group replica entry, so the panel paints from the persisted
// row on reload and follows optimistic status changes like the board does.
const HIDDEN_STATUSES = ['canceled', 'completed'] as const;
const STATUS_ORDER = ['needsInput', 'backlog', 'running'];

/** The agent sidebar's non-empty status groups, in panel order. */
export const useSidebarTaskGroups = (agentId?: string) => {
  const useFetchTaskGroupList = useTaskStore((s) => s.useFetchTaskGroupList);
  const { isLoading, queryKey } = useFetchTaskGroupList({
    agentId,
    enabled: !!agentId,
    excludeStatuses: HIDDEN_STATUSES,
    // The panel ignores the Tasks page's visibility chip.
    visibility: 'all',
  });
  const taskGroups = useTaskStore(taskListSelectors.taskGroups(queryKey));

  const groups = useMemo(() => {
    const map = new Map(taskGroups.map((g) => [g.key, g]));
    return STATUS_ORDER.map((key) => map.get(key)).filter(
      (g): g is TaskGroupItem => !!g && g.tasks.length > 0,
    );
  }, [taskGroups]);

  return { groups, isLoading };
};
