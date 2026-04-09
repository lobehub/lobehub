import type { TaskStoreState } from '../initialState';
import type { TaskGroupItem, TaskListItem } from '../slices/list/initialState';

const taskList = (s: TaskStoreState): TaskListItem[] => s.tasks;

const taskListTotal = (s: TaskStoreState) => s.tasksTotal;

const isTaskListInit = (s: TaskStoreState) => s.isTaskListInit;

const viewMode = (s: TaskStoreState) => s.viewMode;

const statusDisplayMap: Record<string, string> = {
  backlog: 'Backlog',
  canceled: 'Canceled',
  completed: 'Done',
  failed: 'Needs input',
  paused: 'Needs input',
  running: 'In progress',
};

const getDisplayStatus = (status: string): string => statusDisplayMap[status] ?? status;

// ── Kanban selectors (read from taskGroups, populated by groupList API) ──

const taskGroups = (s: TaskStoreState): TaskGroupItem[] => s.taskGroups;

const isTaskGroupListInit = (s: TaskStoreState) => s.isTaskGroupListInit;

const taskGroupByKey = (key: string) => (s: TaskStoreState) =>
  s.taskGroups.find((g) => g.key === key);

const backlogTasks = (s: TaskStoreState) => taskGroupByKey('backlog')(s)?.tasks ?? [];

const runningTasks = (s: TaskStoreState) => taskGroupByKey('running')(s)?.tasks ?? [];

const needsInputTasks = (s: TaskStoreState) => taskGroupByKey('needsInput')(s)?.tasks ?? [];

const doneTasks = (s: TaskStoreState) => taskGroupByKey('done')(s)?.tasks ?? [];

const isListEmpty = (s: TaskStoreState) => s.isTaskListInit && s.tasks.length === 0;

export const taskListSelectors = {
  backlogTasks,
  doneTasks,
  getDisplayStatus,
  isListEmpty,
  isTaskGroupListInit,
  isTaskListInit,
  needsInputTasks,
  runningTasks,
  taskGroupByKey,
  taskGroups,
  taskList,
  taskListTotal,
  viewMode,
};
