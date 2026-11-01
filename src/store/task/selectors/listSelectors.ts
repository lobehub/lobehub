import type { TaskStoreState } from '../initialState';
import type { TaskGroupItem, TaskListItem } from '../slices/list/initialState';

const EMPTY_TASKS: TaskListItem[] = [];
const EMPTY_GROUPS: TaskGroupItem[] = [];

/**
 * Lists are keyed by their query (`queryKey` from `useFetchTaskList`), so two
 * surfaces fetching different lists never read each other's rows.
 */
const taskList =
  (queryKey?: string) =>
  (s: TaskStoreState): TaskListItem[] =>
    (queryKey && s.taskListMap[queryKey]?.items) || EMPTY_TASKS;

const taskListTotal = (queryKey?: string) => (s: TaskStoreState) =>
  (queryKey && s.taskListMap[queryKey]?.total) || 0;

/** The list has a value to show (from storage or the server). */
const isTaskListInit = (queryKey?: string) => (s: TaskStoreState) =>
  !!queryKey && !!s.taskListMap[queryKey];

const listVisibility = (s: TaskStoreState) => s.listVisibility;

const statusDisplayMap: Record<string, string> = {
  backlog: 'Backlog',
  canceled: 'Canceled',
  completed: 'Done',
  failed: 'Needs input',
  paused: 'Needs input',
  running: 'In progress',
  scheduled: 'Scheduled',
};

const getDisplayStatus = (status: string): string => statusDisplayMap[status] ?? status;

// ── Kanban selectors (keyed by `queryKey` from `useFetchTaskGroupList`) ──

const taskGroups =
  (queryKey?: string) =>
  (s: TaskStoreState): TaskGroupItem[] =>
    (queryKey && s.taskGroupListMap[queryKey]?.groups) || EMPTY_GROUPS;

const isTaskGroupListInit = (queryKey?: string) => (s: TaskStoreState) =>
  !!queryKey && !!s.taskGroupListMap[queryKey];

const isListEmpty = (queryKey?: string) => (s: TaskStoreState) =>
  isTaskListInit(queryKey)(s) && taskList(queryKey)(s).length === 0;

export const taskListSelectors = {
  getDisplayStatus,
  isListEmpty,
  isTaskGroupListInit,
  isTaskListInit,
  listVisibility,
  taskGroups,
  taskList,
  taskListTotal,
};
