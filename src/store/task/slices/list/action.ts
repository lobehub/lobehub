import { mutate, useClientDataSWR } from '@/libs/swr';
import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';

import type { TaskStore } from '../../store';
import type { TaskGroupItem, TaskListItem, TaskViewMode } from './initialState';

const FETCH_TASK_LIST_KEY = 'fetchTaskList';
const FETCH_TASK_GROUP_LIST_KEY = 'fetchTaskGroupList';

/**
 * Sentinel used as `listAgentId` when the task list is showing tasks across all agents
 * (e.g. the `/tasks` page). Keeps the SWR cache key distinct from per-agent lists so
 * the two don't collide and `refreshTaskList()` can invalidate the correct entry.
 */
export const ALL_AGENTS_LIST_KEY = '__all__';

// Default kanban groups: 5 columns
const DEFAULT_KANBAN_GROUPS = [
  { key: 'backlog', statuses: ['backlog'] },
  { key: 'running', statuses: ['running'] },
  { key: 'needsInput', statuses: ['paused', 'failed'] },
  { key: 'done', statuses: ['completed'] },
  { key: 'canceled', statuses: ['canceled'] },
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

  fetchTaskList = async (params: Parameters<typeof taskService.list>[0]) =>
    taskService.list(params);

  refreshTaskList = async (): Promise<void> => {
    const { listAgentId } = this.#get();
    await Promise.all([
      mutate([FETCH_TASK_LIST_KEY, listAgentId]),
      mutate([FETCH_TASK_GROUP_LIST_KEY, listAgentId]),
    ]);
  };

  setListAgentId = (agentId?: string): void => {
    this.#set({ listAgentId: agentId }, false, 'setListAgentId');
  };

  setViewMode = (mode: TaskViewMode): void => {
    this.#set({ viewMode: mode }, false, 'setViewMode');
  };

  useFetchTaskGroupList = (
    options: {
      agentId?: string;
      allAgents?: boolean;
      enabled?: boolean;
    } = {},
  ) => {
    const { agentId, allAgents = false, enabled = true } = options;
    const effectiveKey = allAgents ? ALL_AGENTS_LIST_KEY : agentId;
    if (effectiveKey && this.#get().listAgentId !== effectiveKey) {
      this.#set({ listAgentId: effectiveKey }, false, 'useFetchTaskGroupList/syncAgentId');
    }

    return useClientDataSWR(
      enabled && effectiveKey ? [FETCH_TASK_GROUP_LIST_KEY, effectiveKey] : null,
      async () => {
        return taskService.groupList({
          assigneeAgentId: allAgents ? undefined : agentId,
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

  useFetchTaskList = (
    options: {
      agentId?: string;
      allAgents?: boolean;
      enabled?: boolean;
    } = {},
  ) => {
    const { agentId, allAgents = false, enabled = true } = options;
    const effectiveKey = allAgents ? ALL_AGENTS_LIST_KEY : agentId;
    if (effectiveKey && this.#get().listAgentId !== effectiveKey) {
      this.#set({ listAgentId: effectiveKey }, false, 'useFetchTaskList/syncAgentId');
    }

    return useClientDataSWR(
      enabled && effectiveKey ? [FETCH_TASK_LIST_KEY, effectiveKey] : null,
      async ([, id]: [string, string]) => {
        return this.fetchTaskList(allAgents ? {} : { assigneeAgentId: id });
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
