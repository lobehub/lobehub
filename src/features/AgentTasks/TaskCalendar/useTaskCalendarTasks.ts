import { normalizeTaskListFilter, type TaskListFilter } from '@lobechat/types';

import { useClientDataSWR } from '@/libs/swr';
import { taskService } from '@/services/task';
import { useTaskStore } from '@/store/task';
import { filterToServerVisibility } from '@/store/task/slices/list/action';

import type { TaskCollection } from '../shared/taskCollection';
import type { CalendarRange } from './calendarModel';

/**
 * The most tasks one calendar month asks for: the server's page cap. Completed
 * tasks are windowed to the grid server-side, so the cap only bites on a month
 * with more completions than that; past it the newest-updated tasks win.
 */
export const TASK_CALENDAR_PAGE_SIZE = 500;

export interface TaskCalendarQueryOptions {
  agentId?: string;
  collection: TaskCollection;
  /** The Tasks page filter, applied server-side exactly as the list applies it. */
  filter?: TaskListFilter;
  includeArchived?: boolean;
  myTaskScope?: 'assigned' | 'created';
  projectId?: string;
  range: CalendarRange;
}

type TaskListParams = Parameters<typeof taskService.list>[0];

/**
 * The `task.list` request behind one calendar month. The scheduled collection
 * asks for its recurring tasks with the runs they started inside the grid; the
 * other collections ask for their completed tasks, the only ones with a day.
 */
export const buildTaskCalendarParams = (
  {
    agentId,
    collection,
    filter,
    includeArchived,
    myTaskScope,
    projectId,
    range,
  }: TaskCalendarQueryOptions,
  visibility: 'private' | 'public' | undefined,
): TaskListParams => {
  const common = {
    filter: normalizeTaskListFilter(filter),
    limit: TASK_CALENDAR_PAGE_SIZE,
    offset: 0,
    orderBy: 'updatedAt' as const,
  };

  if (collection === 'scheduled') {
    return {
      ...common,
      ...(agentId && !projectId ? { assigneeAgentId: agentId } : {}),
      automated: true,
      projectId,
      runsBetween: range,
    };
  }

  const completed = {
    ...common,
    completedBetween: range,
    includeArchived: includeArchived || undefined,
    statuses: ['completed' as const],
  };
  if (collection === 'mine') return { ...completed, scope: myTaskScope ?? 'assigned' };

  return {
    ...completed,
    ...(agentId && !projectId ? { assigneeAgentId: agentId } : {}),
    automated: false,
    projectId,
    // A project's page lists every task of the project, like its list view.
    visibility: projectId ? undefined : visibility,
  };
};

export const useTaskCalendarTasks = (options: TaskCalendarQueryOptions) => {
  const listVisibility = useTaskStore((s) => s.listVisibility);
  const params = buildTaskCalendarParams(options, filterToServerVisibility(listVisibility));

  return useClientDataSWR(
    ['task-calendar', JSON.stringify(params)],
    async () => (await taskService.list(params)).data,
    { revalidateOnFocus: false },
  );
};
