import type { TaskListFilter } from '@lobechat/types';
import { useCallback } from 'react';

import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { upsertTaskListFilterEntry } from './taskFilterState';

/**
 * The persisted filter of one Tasks page scope (`taskListFilterScopeKey`) and
 * its setter. The setter takes an updater so rapid edits (several values
 * checked in one open menu) build on the latest stored filter.
 */
export const useTaskListFilter = (scope: string) => {
  const filter = useGlobalStore(systemStatusSelectors.taskListFilter(scope));
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const setFilter = useCallback(
    (updater: (prev: TaskListFilter | undefined) => TaskListFilter | undefined) => {
      const state = useGlobalStore.getState();
      const entries = systemStatusSelectors.taskListFilters(state);
      const prev = systemStatusSelectors.taskListFilter(scope)(state);
      updateSystemStatus(
        { taskListFilters: upsertTaskListFilterEntry(entries, scope, updater(prev)) },
        'updateTaskListFilter',
      );
    },
    [scope, updateSystemStatus],
  );

  return [filter, setFilter] as const;
};
