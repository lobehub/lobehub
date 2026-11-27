import { normalizeTaskListFilter, type TaskListFilter } from '@lobechat/types';

import { useClientDataSWR } from '@/libs/swr';
import { taskService } from '@/services/task';
import { useTaskStore } from '@/store/task';
import { filterToServerVisibility } from '@/store/task/slices/list/action';

import type { TaskCollection } from '../shared/taskCollection';
import type { CalendarRange } from './calendarModel';

/** One request's page: the server's page cap. */
export const TASK_CALENDAR_PAGE_SIZE = 500;

/**
 * The most tasks one calendar month walks to. Completed tasks are windowed to
 * the grid server-side, so this only bites on a month with more completions
 * (or a scope with more live schedules); the calendar then says it is partial.
 */
export const TASK_CALENDAR_MAX_TASKS = 1000;

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

type TaskListResult = Awaited<ReturnType<typeof taskService.list>>;

export interface TaskCalendarData {
  tasks: TaskListResult['data'];
  /** Some tasks or runs of the month were left out by the page or run caps. */
  truncated: boolean;
}

/**
 * Walk the month's pages with the list's keyset cursor (an offset page would
 * repeat or skip a row that moves mid-walk) up to `TASK_CALENDAR_MAX_TASKS`.
 */
export const fetchTaskCalendar = async (
  params: TaskListParams,
  fetchPage: (params: TaskListParams) => Promise<TaskListResult> = taskService.list,
): Promise<TaskCalendarData> => {
  const tasks: TaskListResult['data'] = [];
  let truncated = false;
  let page = await fetchPage(params);
  const total = page.total ?? 0;
  for (;;) {
    tasks.push(...page.data);
    if ('rangeRunsTruncated' in page && page.rangeRunsTruncated) truncated = true;
    const last = page.data.at(-1);
    if (!last || page.data.length < TASK_CALENDAR_PAGE_SIZE) break;
    if (tasks.length >= TASK_CALENDAR_MAX_TASKS) {
      truncated = truncated || total > tasks.length;
      break;
    }
    page = await fetchPage({
      ...params,
      after: { at: last.updatedAt, seq: last.seq },
      offset: undefined,
    });
  }
  return { tasks, truncated };
};

export const useTaskCalendarTasks = (options: TaskCalendarQueryOptions) => {
  const listVisibility = useTaskStore((s) => s.listVisibility);
  const params = buildTaskCalendarParams(options, filterToServerVisibility(listVisibility));

  // Runs start and finish in the background, so the month refreshes whenever
  // the viewer comes back to it (the client SWR default).
  return useClientDataSWR(['task-calendar', JSON.stringify(params)], () =>
    fetchTaskCalendar(params),
  );
};
