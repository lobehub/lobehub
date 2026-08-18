import type { TaskStatus } from '@lobechat/types';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { isTaskListKey, taskKeys } from '@/libs/swr/keys';
import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';

import type { TaskStore } from '../../store';
import type { TaskGroupItem, TaskListItem, TaskListVisibilityFilter } from './initialState';

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
    await mutate(
      taskKeys.groupList(listAgentId, listVisibility, projectIdFromListKey(listAgentId)),
    );
  };

  fetchTaskList = async (params: Parameters<typeof taskService.list>[0]) =>
    taskService.list(params);

  refreshTaskList = async (): Promise<void> => {
    const { listAgentId, listVisibility } = this.#get();
    const projectId = projectIdFromListKey(listAgentId);
    await Promise.all([
      // Every cached variant of the list — both orderings, any visibility chip
      // or automation filter — an edit can move a task across each of those
      // boundaries (touching reorders `updatedAt`, scheduling flips the
      // automation filter), so they are invalidated by root, not enumerated.
      mutate(isTaskListKey),
      mutate(taskKeys.groupList(listAgentId, listVisibility, projectId)),
      // A schedule can be attached, changed or removed from any task edit, so
      // the automated roll-up has to be revalidated alongside the main list.
      mutate(taskKeys.scheduledList(ALL_AGENTS_LIST_KEY)),
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
        listQueryVisibility: visibility,
        listVisibility: visibility,
      },
      false,
      'setListVisibility',
    );
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
      this.#set(
        { ...scopeChangeResetState, listAgentId: effectiveKey },
        false,
        'useFetchTaskGroupList/syncAgentId',
      );
    }
    const listVisibility = this.#get().listVisibility;

    return useClientDataSWR(
      enabled && effectiveKey ? taskKeys.groupList(effectiveKey, listVisibility, projectId) : null,
      async () => {
        return taskService.groupList({
          assigneeAgentId: allAgents ? undefined : agentId,
          groups: DEFAULT_KANBAN_GROUPS,
          hasGoal: false,
          projectId,
          visibility: filterToServerVisibility(listVisibility),
        });
      },
      {
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

  /**
   * The automated-task roll-up behind Home's "Scheduled" section. Always
   * cross-agent and unnarrowed by visibility: Home is an overview, not a
   * continuation of the Task page's filter chip — so it needs neither the
   * agent scope nor the visibility argument the main list carries, and its
   * own state fields keep it from colliding with `tasks`.
   */
  useFetchScheduledTaskList = (options: { enabled?: boolean; limit?: number } = {}) => {
    const { enabled = true, limit } = options;

    return useClientDataSWR(
      enabled ? taskKeys.scheduledList(ALL_AGENTS_LIST_KEY) : null,
      async () =>
        this.fetchTaskList({ automated: true, hasGoal: false, limit, orderBy: 'updatedAt' }),
      {
        onSuccess: (data: { data: TaskListItem[]; total: number }) => {
          this.#set(
            {
              isScheduledTaskListInit: true,
              scheduledTasks: data.data,
              scheduledTasksTotal: data.total,
            },
            false,
            'useFetchScheduledTaskList/onSuccess',
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
      /**
       * Server-side automation filter: `false` excludes the tasks that still
       * fire on their own (Home's recent block — those live in the scheduled
       * roll-up), `true` is that roll-up's own side, undefined applies no
       * filter. Part of the cache key and the scope reset for the same reason
       * as `orderBy` and `visibility`.
       */
      automated?: boolean;
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
      /**
       * Server-side status narrowing (include-list). Home's recent block uses
       * it to drop finished work; the Tasks page omits it. Same key/scope
       * treatment as `automated`.
       */
      statuses?: readonly TaskStatus[];
      /** Override the Task page's persisted filter for embedded consumers. */
      visibility?: TaskListVisibilityFilter;
    } = {},
  ) => {
    const {
      agentId,
      allAgents = false,
      automated,
      enabled = true,
      orderBy,
      projectId,
      statuses,
      visibility,
    } = options;
    const effectiveKey = projectId
      ? `${PROJECT_LIST_KEY_PREFIX}${projectId}`
      : allAgents
        ? ALL_AGENTS_LIST_KEY
        : agentId;
    const listVisibility = visibility ?? this.#get().listVisibility;
    // Order-insensitive signature, only for change detection in the scope guard.
    const statusesSignature = statuses?.length ? [...statuses].sort().join(',') : undefined;
    const { listAgentId, listQueryAutomated, listQueryStatuses, listQueryVisibility } = this.#get();

    // `tasks` is shared by the full Tasks page and embedded overviews. Reset it
    // when any part of the effective query changes so an `all` override does
    // not temporarily inherit a previously initialized private/workspace list,
    // nor the Tasks page a list narrowed by Home's automation/status filters.
    if (
      effectiveKey &&
      (listAgentId !== effectiveKey ||
        listQueryVisibility !== listVisibility ||
        listQueryAutomated !== automated ||
        listQueryStatuses !== statusesSignature)
    ) {
      this.#set(
        {
          ...scopeChangeResetState,
          listAgentId: effectiveKey,
          listQueryAutomated: automated,
          listQueryStatuses: statusesSignature,
          listQueryVisibility: listVisibility,
        },
        false,
        'useFetchTaskList/syncQueryScope',
      );
    }

    return useClientDataSWR(
      enabled && effectiveKey
        ? taskKeys.list(effectiveKey, listVisibility, orderBy, projectId, { automated, statuses })
        : null,
      async ([, id]: [string, string]) => {
        return this.fetchTaskList({
          ...(allAgents || projectId ? {} : { assigneeAgentId: id }),
          automated,
          hasGoal: false,
          orderBy,
          projectId,
          statuses: statuses?.length ? [...statuses] : undefined,
          visibility: filterToServerVisibility(listVisibility),
        });
      },
      {
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
