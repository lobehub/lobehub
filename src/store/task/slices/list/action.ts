import type { TaskStatus } from '@lobechat/types';
import { useEffect } from 'react';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { isMyTaskListKey, isScheduledTaskListKey, isTaskListKey, taskKeys } from '@/libs/swr/keys';
import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';

import type { TaskStore } from '../../store';
import type {
  TaskGroupItem,
  TaskKanbanGroupBy,
  TaskListItem,
  TaskListVisibilityFilter,
} from './initialState';

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
 * `complete` mode paging. The server caps one `task.list` page at 100 rows, so
 * the full list is assembled from consecutive pages; the ceiling bounds the
 * fan-out for very large workspaces (10 requests) — past it the store keeps
 * the real `total` so the list can say it is showing a subset.
 */
export const COMPLETE_TASK_LIST_PAGE_SIZE = 100;
export const COMPLETE_TASK_LIST_MAX_ITEMS = 1000;

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
    const {
      groupListQueryAutomated,
      listAgentId,
      listGroupBy,
      listGroupExcludeStatuses,
      listVisibility,
    } = this.#get();
    await mutate(
      taskKeys.groupList(
        listAgentId,
        listVisibility,
        listGroupBy,
        listGroupExcludeStatuses,
        projectIdFromListKey(listAgentId),
        groupListQueryAutomated,
      ),
    );
  };

  fetchTaskList = async (params: Parameters<typeof taskService.list>[0]) =>
    taskService.list(params);

  /**
   * Every page of a list, merged, walked with a keyset cursor: each request
   * asks for the rows after the last row it already holds, so a task created
   * or deleted while the walk is in flight shifts nothing — offset pages would
   * repeat or skip a row at the boundary. Stops at a short page or at
   * `COMPLETE_TASK_LIST_MAX_ITEMS`; `total` is the first page's live count.
   */
  fetchCompleteTaskList = async (
    params: Omit<Parameters<typeof taskService.list>[0], 'after' | 'limit' | 'offset'>,
  ) => {
    const limit = COMPLETE_TASK_LIST_PAGE_SIZE;
    const orderBy = params.orderBy ?? 'createdAt';
    const first = await this.fetchTaskList({ ...params, limit });

    const byId = new Map<string, (typeof first.data)[number]>();
    let page = first;
    for (;;) {
      for (const task of page.data) byId.set(task.id, task);
      const last = page.data.at(-1);
      if (!last || page.data.length < limit || byId.size >= COMPLETE_TASK_LIST_MAX_ITEMS) break;
      page = await this.fetchTaskList({
        ...params,
        after: { at: last[orderBy], seq: last.seq },
        limit,
      });
    }

    return { ...first, data: [...byId.values()] };
  };

  refreshTaskList = async (): Promise<void> => {
    const {
      groupListQueryAutomated,
      listAgentId,
      listGroupBy,
      listGroupExcludeStatuses,
      listVisibility,
    } = this.#get();
    const projectId = projectIdFromListKey(listAgentId);
    await Promise.all([
      // Every cached variant of the list — both orderings, any visibility chip
      // or automation filter — an edit can move a task across each of those
      // boundaries (touching reorders `updatedAt`, scheduling flips the
      // automation filter), so they are invalidated by root, not enumerated.
      mutate(isTaskListKey),
      mutate(
        taskKeys.groupList(
          listAgentId,
          listVisibility,
          listGroupBy,
          listGroupExcludeStatuses,
          projectId,
          groupListQueryAutomated,
        ),
      ),
      // A schedule can be attached, changed or removed from any task edit, so
      // the automated roll-up has to be revalidated alongside the main list.
      mutate(isScheduledTaskListKey),
      // Assigning or creating moves a task in or out of "My tasks".
      mutate(isMyTaskListKey),
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
      automated?: boolean;
      enabled?: boolean;
      excludeStatuses?: readonly TaskStatus[];
      groupBy?: TaskKanbanGroupBy;
      projectId?: string;
    } = {},
  ) => {
    const {
      agentId,
      allAgents = false,
      automated,
      enabled = true,
      excludeStatuses,
      groupBy = 'status',
      projectId,
    } = options;
    const effectiveKey = projectId
      ? `${PROJECT_LIST_KEY_PREFIX}${projectId}`
      : allAgents
        ? ALL_AGENTS_LIST_KEY
        : agentId;
    const excludeStatusesSignature = excludeStatuses?.length
      ? [...excludeStatuses].sort().join(',')
      : undefined;
    const { groupListQueryAutomated, listAgentId, listGroupBy, listGroupExcludeStatuses } =
      this.#get();
    const isQueryScopeCurrent =
      !effectiveKey ||
      (listAgentId === effectiveKey &&
        groupListQueryAutomated === automated &&
        listGroupBy === groupBy &&
        listGroupExcludeStatuses === excludeStatusesSignature);

    // Reset after render so changing the board dimension never notifies React
    // subscribers while another component is rendering. The caller gates old
    // groups with `isQueryScopeCurrent` until this effect commits the new scope.
    useEffect(() => {
      if (!effectiveKey) return;

      const current = this.#get();
      if (
        current.listAgentId === effectiveKey &&
        current.groupListQueryAutomated === automated &&
        current.listGroupBy === groupBy &&
        current.listGroupExcludeStatuses === excludeStatusesSignature
      ) {
        return;
      }

      this.#set(
        current.listAgentId !== effectiveKey
          ? {
              ...scopeChangeResetState,
              groupListQueryAutomated: automated,
              listAgentId: effectiveKey,
              listGroupBy: groupBy,
              listGroupExcludeStatuses: excludeStatusesSignature,
            }
          : {
              isTaskGroupListInit: false,
              groupListQueryAutomated: automated,
              listGroupBy: groupBy,
              listGroupExcludeStatuses: excludeStatusesSignature,
              taskGroups: [],
            },
        false,
        'useFetchTaskGroupList/syncQueryScope',
      );
    }, [automated, effectiveKey, excludeStatusesSignature, groupBy]);
    const listVisibility = this.#get().listVisibility;

    const swr = useClientDataSWR(
      enabled && effectiveKey
        ? taskKeys.groupList(
            effectiveKey,
            listVisibility,
            groupBy,
            excludeStatusesSignature,
            projectId,
            automated,
          )
        : null,
      async () => {
        return taskService.groupList({
          assigneeAgentId: allAgents ? undefined : agentId,
          ...(automated === undefined ? {} : { automated }),
          excludeStatuses: excludeStatuses?.length ? [...excludeStatuses] : undefined,
          ...(groupBy === 'status' ? { groups: DEFAULT_KANBAN_GROUPS } : { groupBy }),
          projectId,
          visibility: filterToServerVisibility(listVisibility),
        });
      },
      {
        onSuccess: (data: { data: TaskGroupItem[] }) => {
          const current = this.#get();
          if (
            current.listAgentId !== effectiveKey ||
            current.groupListQueryAutomated !== automated ||
            current.listGroupBy !== groupBy ||
            current.listGroupExcludeStatuses !== excludeStatusesSignature ||
            current.listVisibility !== listVisibility
          ) {
            return;
          }

          this.#set(
            { isTaskGroupListInit: true, taskGroups: data.data },
            false,
            'useFetchTaskGroupList/onSuccess',
          );
        },
        revalidateOnFocus: false,
      },
    );

    return { ...swr, isQueryScopeCurrent };
  };

  /**
   * The automated-task roll-up behind Home's "Scheduled" section and the Tasks
   * page's scheduled tab. Each caller consumes its own SWR result because Home
   * and the paginated Tasks page can coexist in Electron with different limits
   * and offsets. `agentId`/`projectId` narrow the roll-up to the scoped Tasks
   * page; they are part of the key so an agent's schedules never render under
   * another scope.
   */
  useFetchScheduledTaskList = (
    options: {
      agentId?: string;
      enabled?: boolean;
      limit?: number;
      offset?: number;
      projectId?: string;
    } = {},
  ) => {
    const { agentId, enabled = true, limit, offset, projectId } = options;
    const scopeKey = projectId
      ? `${PROJECT_LIST_KEY_PREFIX}${projectId}`
      : (agentId ?? ALL_AGENTS_LIST_KEY);
    return useClientDataSWR(
      enabled ? taskKeys.scheduledList(scopeKey, 'all', limit, offset) : null,
      async () =>
        this.fetchTaskList({
          ...(projectId ? { projectId } : agentId ? { assigneeAgentId: agentId } : {}),
          automated: true,
          limit,
          offset,
          orderBy: 'updatedAt',
        }),
      { revalidateOnFocus: false },
    );
  };

  /**
   * The Tasks page's "My tasks" tab — the caller's own slice of the workspace
   * (`assigned` to them as a member, or `created` by them). Consumed like the
   * scheduled roll-up: its own SWR result, never the shared `tasks` field, so
   * flipping the tab cannot leak one collection into the other.
   */
  useFetchMyTaskList = (options: {
    enabled?: boolean;
    limit?: number;
    offset?: number;
    scope: 'assigned' | 'created';
    /**
     * Server-side status narrowing (the `hideCompleted` display option
     * translated by `getVisibleTaskStatuses`). Applied before `limit` /
     * `offset` so a page can never come back empty while older unfinished
     * tasks exist; part of the cache key for the same reason as `scope`.
     */
    statuses?: TaskStatus[];
  }) => {
    const { enabled = true, limit, offset, scope, statuses } = options;
    return useClientDataSWR(
      enabled ? taskKeys.myList(scope, statuses, limit, offset) : null,
      async () => this.fetchTaskList({ limit, offset, orderBy: 'updatedAt', scope, statuses }),
      { revalidateOnFocus: false },
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
      /**
       * Fetch every page instead of the first server page. The Tasks page
       * renders and groups the whole list client-side with no pagination, so
       * a single page silently dropped every task older than the newest 50
       * once a workspace outgrew that. Embedded overviews that
       * only show a slice keep the default single page.
       */
      complete?: boolean;
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
      complete = false,
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
    const {
      listAgentId,
      listQueryAutomated,
      listQueryComplete,
      listQueryStatuses,
      listQueryVisibility,
    } = this.#get();

    // `tasks` is shared by the full Tasks page and embedded overviews. Reset it
    // when any part of the effective query changes so an `all` override does
    // not temporarily inherit a previously initialized private/workspace list,
    // nor the Tasks page a list narrowed by Home's automation/status filters,
    // nor the list view a single kanban page posing as the complete list.
    if (
      effectiveKey &&
      (listAgentId !== effectiveKey ||
        listQueryVisibility !== listVisibility ||
        listQueryAutomated !== automated ||
        listQueryComplete !== complete ||
        listQueryStatuses !== statusesSignature)
    ) {
      this.#set(
        {
          ...scopeChangeResetState,
          listAgentId: effectiveKey,
          listQueryAutomated: automated,
          listQueryComplete: complete,
          listQueryStatuses: statusesSignature,
          listQueryVisibility: listVisibility,
        },
        false,
        'useFetchTaskList/syncQueryScope',
      );
    }

    return useClientDataSWR(
      enabled && effectiveKey
        ? taskKeys.list(effectiveKey, listVisibility, orderBy, projectId, {
            automated,
            complete,
            statuses,
          })
        : null,
      async ([, id]: [string, string]) => {
        const params = {
          ...(allAgents || projectId ? {} : { assigneeAgentId: id }),
          automated,
          orderBy,
          projectId,
          statuses: statuses?.length ? [...statuses] : undefined,
          visibility: filterToServerVisibility(listVisibility),
        };
        return complete ? this.fetchCompleteTaskList(params) : this.fetchTaskList(params);
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
