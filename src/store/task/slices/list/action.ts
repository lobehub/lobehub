import { mutate, useClientDataSWR } from '@/libs/swr';
import { taskKeys } from '@/libs/swr/keys';
import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';

import type { TaskStore } from '../../store';
import type {
  TaskGroupItem,
  TaskListItem,
  TaskListVisibilityFilter,
  TaskViewMode,
} from './initialState';

/**
 * Sentinel used as `listAgentId` when the task list is showing tasks across all agents
 * (e.g. the `/tasks` page). Keeps the SWR cache key distinct from per-agent lists so
 * the two don't collide and `refreshTaskList()` can invalidate the correct entry.
 */
export const ALL_AGENTS_LIST_KEY = '__all__';

// Default kanban groups: 5 columns
// 'scheduled' shares the 'running' column — both represent "automation in
// progress" from the user's perspective (one is mid-tick, the other is
// waiting for the next tick).
// `needsInput` is intentionally first: in the list view it surfaces the
// actionable items at the top of the page.
const DEFAULT_KANBAN_GROUPS = [
  { key: 'needsInput', statuses: ['paused', 'failed'] },
  { key: 'backlog', statuses: ['backlog'] },
  { key: 'running', statuses: ['running', 'scheduled'] },
  { key: 'done', statuses: ['completed'] },
  { key: 'canceled', statuses: ['canceled'] },
];

/**
 * Map the UI-side filter chip value to the server-side `visibility` enum.
 * 'all' has no server filter (undefined), 'workspace' translates to the DB
 * 'public' value, and 'private' passes through unchanged.
 */
const filterToServerVisibility = (
  filter: 'all' | 'private' | 'workspace',
): 'private' | 'public' | undefined => {
  if (filter === 'all') return undefined;
  if (filter === 'workspace') return 'public';
  return 'private';
};

/**
 * Cleared whenever the list scope changes (all-agents <-> a specific agent).
 * The list and group datasets are shared store fields, so without this reset
 * the previous scope's tasks would render until the new fetch resolves — e.g.
 * the `/tasks` page briefly showing only the last-visited agent's tasks.
 */
const scopeChangeResetState = {
  isTaskGroupListInit: false,
  isTaskListInit: false,
  taskGroups: [] as TaskGroupItem[],
  tasks: [] as TaskListItem[],
  tasksTotal: 0,
};

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
    const { listAgentId, listVisibility } = this.#get();
    await mutate(taskKeys.groupList(listAgentId, listVisibility));
  };

  fetchTaskList = async (params: Parameters<typeof taskService.list>[0]) =>
    taskService.list(params);

  refreshTaskList = async (): Promise<void> => {
    const { listAgentId, listVisibility } = this.#get();
    await Promise.all([
      mutate(taskKeys.list(listAgentId, listVisibility)),
      mutate(taskKeys.groupList(listAgentId, listVisibility)),
    ]);
  };

  setListAgentId = (agentId?: string): void => {
    this.#set({ listAgentId: agentId }, false, 'setListAgentId');
  };

  setListVisibility = (visibility: TaskListVisibilityFilter): void => {
    if (this.#get().listVisibility === visibility) return;
    // Clear the cached list so the chip flip doesn't render stale entries
    // from the previous filter while the new fetch is in flight.
    this.#set(
      {
        ...scopeChangeResetState,
        listVisibility: visibility,
      },
      false,
      'setListVisibility',
    );
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
      this.#set(
        { ...scopeChangeResetState, listAgentId: effectiveKey },
        false,
        'useFetchTaskGroupList/syncAgentId',
      );
    }
    const listVisibility = this.#get().listVisibility;

    return useClientDataSWR(
      enabled && effectiveKey ? taskKeys.groupList(effectiveKey, listVisibility) : null,
      async () => {
        return taskService.groupList({
          assigneeAgentId: allAgents ? undefined : agentId,
          groups: DEFAULT_KANBAN_GROUPS,
          visibility: filterToServerVisibility(listVisibility),
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
      this.#set(
        { ...scopeChangeResetState, listAgentId: effectiveKey },
        false,
        'useFetchTaskList/syncAgentId',
      );
    }
    const listVisibility = this.#get().listVisibility;

    return useClientDataSWR(
      enabled && effectiveKey ? taskKeys.list(effectiveKey, listVisibility) : null,
      async ([, id]: [string, string]) => {
        return this.fetchTaskList({
          ...(allAgents ? {} : { assigneeAgentId: id }),
          visibility: filterToServerVisibility(listVisibility),
        });
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
