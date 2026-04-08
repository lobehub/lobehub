import { mutate, useClientDataSWR } from '@/libs/swr';
import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';

import type { TaskStore } from '../../store';
import type { TaskGroupItem, TaskListItem, TaskViewMode } from './initialState';

const FETCH_TASK_LIST_KEY = 'fetchTaskList';
const FETCH_TASK_GROUP_LIST_KEY = 'fetchTaskGroupList';

// Default kanban groups: 4 columns
const DEFAULT_KANBAN_GROUPS = [
  { key: 'backlog', statuses: ['backlog'] },
  { key: 'running', statuses: ['running'] },
  { key: 'needsInput', statuses: ['paused', 'failed'] },
  { key: 'done', statuses: ['completed'] },
];

type Setter = StoreSetter<TaskStore>;

export const createTaskListSlice = (set: Setter, get: () => TaskStore, _api?: unknown) =>
  new TaskListSliceActionImpl(set, get, _api);

export class TaskListSliceActionImpl {
  readonly #get: () => TaskStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => TaskStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  refreshTaskGroupList = async (): Promise<void> => {
    const { listAgentId } = this.#get();
    await mutate([FETCH_TASK_GROUP_LIST_KEY, listAgentId]);
  };

  refreshTaskList = async (): Promise<void> => {
    const { listAgentId } = this.#get();
    await mutate([FETCH_TASK_LIST_KEY, listAgentId]);
  };

  setListAgentId = (agentId?: string): void => {
    this.#set({ listAgentId: agentId }, false, 'setListAgentId');
  };

  setViewMode = (mode: TaskViewMode): void => {
    this.#set({ viewMode: mode }, false, 'setViewMode');
  };

  useFetchTaskGroupList = (agentId?: string, enabled: boolean = true) => {
    if (agentId && this.#get().listAgentId !== agentId) {
      this.#set({ listAgentId: agentId }, false, 'useFetchTaskGroupList/syncAgentId');
    }

    return useClientDataSWR(
      enabled && agentId ? [FETCH_TASK_GROUP_LIST_KEY, agentId] : null,
      async ([, id]: [string, string]) => {
        return taskService.groupList({
          assigneeAgentId: id,
          groups: DEFAULT_KANBAN_GROUPS,
        });
      },
      {
        fallbackData: { data: [], success: true },
        onSuccess: (data: { data: TaskGroupItem[] }) => {
          this.#set(
            { isTaskGroupListInit: true, taskGroups: data.data },
            false,
            'useFetchTaskGroupList/onSuccess',
          );
        },
        revalidateOnFocus: false,
      },
    );
  };

  useFetchTaskList = (agentId?: string, enabled: boolean = true) => {
    // Sync listAgentId so refreshTaskList() uses the correct SWR key
    if (agentId && this.#get().listAgentId !== agentId) {
      this.#set({ listAgentId: agentId }, false, 'useFetchTaskList/syncAgentId');
    }

    return useClientDataSWR(
      enabled && agentId ? [FETCH_TASK_LIST_KEY, agentId] : null,
      async ([, id]: [string, string]) => {
        return taskService.list({ assigneeAgentId: id });
      },
      {
        fallbackData: { data: [], success: true, total: 0 },
        onSuccess: (data: { data: TaskListItem[]; total: number }) => {
          this.#set(
            {
              isTaskListInit: true,
              tasks: data.data,
              tasksTotal: data.total,
            },
            false,
            'useFetchTaskList/onSuccess',
          );
        },
        revalidateOnFocus: false,
      },
    );
  };
}

export type TaskListSliceAction = Pick<TaskListSliceActionImpl, keyof TaskListSliceActionImpl>;
