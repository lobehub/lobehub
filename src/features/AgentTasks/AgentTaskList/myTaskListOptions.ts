import type { TaskListFilter } from '@lobechat/types';

import { type MyTaskListOptions, TASK_COLLECTION_PAGE_SIZE } from '@/store/task/slices/list/action';

import type { MyTaskScope } from '../shared/taskCollection';
import type { TaskListViewOptions } from './listViewOptions';
import { getCompletedWithin, getVisibleTaskStatuses } from './listViewOptions';

/**
 * The fetch options of one "My tasks" page. The page's sync and the route
 * loader's pre-paint hydrate both derive them here: any difference changes the
 * replica key, and the loader would seed an entry the page never reads.
 */
export const getMyTaskListOptions = ({
  filter,
  page,
  scope,
  viewOptions,
}: {
  filter?: TaskListFilter;
  /** 1-based page number. */
  page: number;
  scope: MyTaskScope;
  viewOptions: Pick<TaskListViewOptions, 'completedTasks' | 'showArchived'>;
}): MyTaskListOptions => ({
  completedWithin: getCompletedWithin(viewOptions),
  filter,
  includeArchived: viewOptions.showArchived,
  limit: TASK_COLLECTION_PAGE_SIZE,
  offset: (page - 1) * TASK_COLLECTION_PAGE_SIZE,
  scope,
  statuses: getVisibleTaskStatuses(viewOptions),
});
