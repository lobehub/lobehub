import type { taskService } from '@/services/task';

// Derive types from TRPC inference via service
export type TaskListItem = Awaited<ReturnType<typeof taskService.list>>['data'][number];
export type TaskGroupItem = Awaited<ReturnType<typeof taskService.groupList>>['data'][number];

export type TaskViewMode = 'kanban' | 'list';

export interface TaskListSliceState {
  isTaskGroupListInit: boolean;
  isTaskListInit: boolean;
  listAgentId?: string;
  taskGroups: TaskGroupItem[];
  tasks: TaskListItem[];
  tasksTotal: number;
  viewMode: TaskViewMode;
}

export const initialTaskListSliceState: TaskListSliceState = {
  isTaskGroupListInit: false,
  isTaskListInit: false,
  taskGroups: [],
  tasks: [],
  tasksTotal: 0,
  viewMode: 'list',
};
