import { mutate } from '@/libs/swr';
import { isTaskListKey, projectionKeys, taskKeys } from '@/libs/swr/keys';
import { getCacheScope } from '@/libs/swr/useCacheScope';
import {
  taskGroupListViewContract,
  taskListViewContract,
  useProjectionViewHydration,
} from '@/projection';
import {
  taskGroupListProjectionQuery,
  taskListProjectionQuery,
} from '@/projection/modules/task/queries';
import { useProjectionRequest } from '@/projection/query/hook';
import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';

import type { TaskStore } from '../../store';
import type { TaskListVisibilityFilter, TaskViewMode } from './initialState';

/**
 * Sentinel used as `listAgentId` when the task list is showing tasks across all agents
 * (e.g. the `/tasks` page). Keeps the SWR cache key distinct from per-agent lists so
 * the two don't collide and `refreshTaskList()` can invalidate the correct entry.
 */
export const ALL_AGENTS_LIST_KEY = '__all__';
const PROJECT_LIST_KEY_PREFIX = '__project__:';

const projectIdFromListKey = (key?: string) =>
  key?.startsWith(PROJECT_LIST_KEY_PREFIX) ? key.slice(PROJECT_LIST_KEY_PREFIX.length) : undefined;

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
    await mutate(
      taskKeys.groupList(listAgentId, listVisibility, projectIdFromListKey(listAgentId)),
    );
  };

  fetchTaskList = async (params: Parameters<typeof taskService.list>[0]) =>
    taskService.list(params);

  refreshTaskList = async (): Promise<void> => {
    const { listAgentId, listQueryVisibility, listVisibility } = this.#get();
    const projectId = projectIdFromListKey(listAgentId);
    await Promise.all([
      // Invalidate every list signature: visibility, ordering and any future
      // filters can all change membership after one task mutation.
      mutate(isTaskListKey),
      mutate(taskKeys.groupList(listAgentId, listVisibility, projectId)),
      // Home keeps ordinary and automated task result sets in distinct
      // Projection indexes; a task edit can change membership in either one.
      mutate(projectionKeys.scheduledTasks(getCacheScope())),
      mutate(projectionKeys.tasks(getCacheScope())),
    ]);
  };

  setListAgentId = (agentId?: string): void => {
    this.#set({ listAgentId: agentId }, false, 'setListAgentId');
  };

  setListVisibility = (visibility: TaskListVisibilityFilter): void => {
    if (this.#get().listVisibility === visibility) return;
    this.#set(
      {
        listQueryVisibility: visibility,
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
      projectId?: string;
    } = {},
  ) => {
    const { agentId, allAgents = false, enabled = true, projectId } = options;
    const effectiveKey = projectId
      ? `${PROJECT_LIST_KEY_PREFIX}${projectId}`
      : allAgents
        ? ALL_AGENTS_LIST_KEY
        : agentId;
    if (effectiveKey && this.#get().listAgentId !== effectiveKey) {
      this.#set({ listAgentId: effectiveKey }, false, 'useFetchTaskGroupList/syncAgentId');
    }
    const listVisibility = this.#get().listVisibility;

    useProjectionViewHydration(
      taskGroupListViewContract,
      { agentKey: effectiveKey ?? '', visibility: listVisibility },
      enabled && Boolean(effectiveKey),
    );

    const requestParams = {
      request: {
        assigneeAgentId: allAgents ? undefined : agentId,
        groups: DEFAULT_KANBAN_GROUPS,
        hasGoal: false,
        projectId,
        visibility: filterToServerVisibility(listVisibility),
      },
      signature: { agentKey: effectiveKey, visibility: listVisibility },
    };
    return useProjectionRequest(
      enabled && effectiveKey ? taskKeys.groupList(effectiveKey, listVisibility, projectId) : null,
      taskGroupListProjectionQuery,
      requestParams,
      { revalidateOnFocus: false },
    );
  };

  useFetchTaskList = (
    options: {
      agentId?: string;
      allAgents?: boolean;
      enabled?: boolean;
      /**
       * Newest-first by creation unless a caller asks otherwise. A block that
       * calls itself "recent" and prints `updatedAt` has to order by it too, or
       * the task that just moved falls off the page in favour of a newer idle
       * one. Part of the cache key: the Tasks page and Home read the same
       * `tasks` field and must not serve each other's ordering.
       */
      orderBy?: 'createdAt' | 'updatedAt';
      projectId?: string;
      /** Override the Task page's persisted filter for embedded consumers. */
      visibility?: TaskListVisibilityFilter;
    } = {},
  ) => {
    const { agentId, allAgents = false, enabled = true, orderBy, projectId, visibility } = options;
    const effectiveKey = projectId
      ? `${PROJECT_LIST_KEY_PREFIX}${projectId}`
      : allAgents
        ? ALL_AGENTS_LIST_KEY
        : agentId;
    const listVisibility = visibility ?? this.#get().listVisibility;
    const { listAgentId, listQueryVisibility } = this.#get();

    useProjectionViewHydration(
      taskListViewContract,
      { agentKey: effectiveKey ?? '', visibility: listVisibility },
      enabled && Boolean(effectiveKey),
    );

    // The selected signature is UI state; result sets remain independently
    // keyed inside Projection, so switching signatures never overwrites data.
    if (effectiveKey && (listAgentId !== effectiveKey || listQueryVisibility !== listVisibility)) {
      this.#set(
        {
          listAgentId: effectiveKey,
          listQueryVisibility: listVisibility,
        },
        false,
        'useFetchTaskList/syncQueryScope',
      );
    }

    const requestParams = {
      request: {
        ...(allAgents || projectId ? {} : { assigneeAgentId: agentId }),
        hasGoal: false,
        orderBy,
        projectId,
        visibility: filterToServerVisibility(listVisibility),
      },
      signature: { agentKey: effectiveKey, visibility: listVisibility },
    };
    return useProjectionRequest(
      enabled && effectiveKey
        ? taskKeys.list(effectiveKey, listVisibility, orderBy, projectId)
        : null,
      taskListProjectionQuery,
      requestParams,
      { revalidateOnFocus: false },
    );
  };
}

export type TaskListSliceAction = Pick<TaskListSliceActionImpl, keyof TaskListSliceActionImpl>;
