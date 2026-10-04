import type { TaskStatus } from '@lobechat/types';

import {
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { mutate, useClientDataSWR } from '@/libs/swr';
import { isMyTaskListKey, isScheduledTaskListKey, taskKeys } from '@/libs/swr/keys';
import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';

import type { TaskStore } from '../../store';
import type { TaskKanbanGroupBy, TaskListVisibilityFilter } from './initialState';
import {
  type CollectionTask,
  taskGroupListEntity,
  type TaskGroupListQuery,
  taskGroupListQueryKey,
  taskGroupListResource,
  type TaskGroupListValue,
  taskListEntity,
  type TaskListQuery,
  taskListQueryKey,
  taskListResource,
  type TaskListValue,
} from './projection';

/**
 * Scope keys of the scheduled roll-up's SWR key: all agents, or one project.
 * Kept distinct from per-agent ids so the entries never collide.
 */
const ALL_AGENTS_LIST_KEY = '__all__';
const PROJECT_LIST_KEY_PREFIX = '__project__:';

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

/** Sync result of a task list / board fetch: replica flags plus the SWR-era aliases. */
export interface TaskCollectionSyncResult extends ReplicaSyncResult {
  /** A request is in flight and there is nothing to show for this query yet. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
  /** Read the collection with `taskListSelectors.*(queryKey)`; undefined while disabled. */
  queryKey?: string;
}

type Setter = StoreSetter<TaskStore>;

export const createTaskListSlice = (set: Setter, get: () => TaskStore, _api?: unknown) =>
  new TaskListSliceActionImpl(set, get, _api);

export class TaskListSliceActionImpl {
  readonly #get: () => TaskStore;
  readonly #set: Setter;
  readonly #taskList;
  readonly #taskGroupList;
  readonly #tasks;

  constructor(set: Setter, get: () => TaskStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#taskList = createReplicaSlice(taskListResource, {
      actionPrefix: 'taskList',
      entity: taskListEntity,
      fetcher: (query) => this.#fetchList(query),
      get,
      merge: (incoming) => ({ items: incoming.data, total: incoming.total }),
      set,
      stateKey: 'taskListReplica',
      view: recordLens<TaskStore, TaskListValue>('taskListMap'),
    });
    this.#taskGroupList = createReplicaSlice(taskGroupListResource, {
      actionPrefix: 'taskGroupList',
      entity: taskGroupListEntity,
      fetcher: (query) => this.#fetchGroups(query),
      get,
      merge: (incoming, _confirmed, query) => ({ groupBy: query.groupBy, groups: incoming.data }),
      set,
      stateKey: 'taskGroupListReplica',
      view: recordLens<TaskStore, TaskGroupListValue>('taskGroupListMap'),
    });
    this.#tasks = linkReplicaEntity<CollectionTask>([this.#taskList, this.#taskGroupList]);
  }

  #fetchList = (query: TaskListQuery) => {
    const params = {
      ...(query.agentId ? { assigneeAgentId: query.agentId } : {}),
      automated: query.automated,
      orderBy: query.orderBy,
      projectId: query.projectId,
      statuses: query.statuses,
      visibility: filterToServerVisibility(query.visibility),
    };
    return query.complete ? this.fetchCompleteTaskList(params) : this.fetchTaskList(params);
  };

  #fetchGroups = (query: TaskGroupListQuery) =>
    taskService.groupList({
      assigneeAgentId: query.agentId,
      ...(query.automated === undefined ? {} : { automated: query.automated }),
      excludeStatuses: query.excludeStatuses,
      ...(query.groupBy === 'status'
        ? { groups: DEFAULT_KANBAN_GROUPS }
        : { groupBy: query.groupBy }),
      projectId: query.projectId,
      scope: query.scope,
      visibility: filterToServerVisibility(query.visibility),
    });

  #toSyncResult = (
    sync: ReplicaSyncResult,
    queryKey: string | undefined,
    hasValue: boolean,
  ): TaskCollectionSyncResult => ({
    ...sync,
    isLoading: sync.isValidating && !hasValue,
    mutate: sync.revalidate,
    queryKey,
  });

  /** The task (by identifier) as any loaded list or board holds it. */
  internal_findCollectionTask = (identifier: string): CollectionTask | undefined => {
    const { taskGroupListMap, taskListMap } = this.#get();
    for (const value of Object.values(taskListMap)) {
      const task = value.items.find((item) => item.identifier === identifier);
      if (task) return task;
    }
    for (const value of Object.values(taskGroupListMap)) {
      for (const group of value.groups) {
        const task = group.tasks.find((item) => item.identifier === identifier);
        if (task) return task;
      }
    }
    return undefined;
  };

  /**
   * Patch a task in every loaded list and board (a status board moves the
   * card). In memory only: the refresh that follows a mutation persists the
   * server value.
   */
  internal_patchCollectionTask = (
    identifier: string,
    fn: <T extends CollectionTask>(task: T) => T,
  ): void => {
    this.#tasks.update(identifier, fn, { persist: false });
  };

  /**
   * Optimistic overlay on one board (a drag between columns): shows now,
   * `commit` keeps it until the refresh lands, `rollback` restores the board.
   */
  internal_beginTaskGroupOptimistic = (
    queryKey: string,
    apply: (value: TaskGroupListValue) => TaskGroupListValue,
  ) => this.#taskGroupList.beginOptimistic(queryKey, apply);

  setActiveTaskListKey = (queryKey?: string): void => {
    if (this.#get().activeTaskListKey === queryKey) return;
    this.#set({ activeTaskListKey: queryKey }, false, 'setActiveTaskListKey');
  };

  refreshTaskGroupList = async (): Promise<void> => {
    await this.#taskGroupList.revalidate();
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
    await Promise.all([
      // Every loaded list and board of the active scope — an edit can move a
      // task across any query boundary (touching reorders `updatedAt`,
      // scheduling flips the automation filter), so none are singled out.
      this.#taskList.revalidate(),
      this.#taskGroupList.revalidate(),
      // A schedule can be attached, changed or removed from any task edit, so
      // the automated roll-up has to be revalidated alongside the main list.
      mutate(isScheduledTaskListKey),
      // Assigning or creating moves a task in or out of "My tasks".
      mutate(isMyTaskListKey),
    ]);
  };

  setListVisibility = (visibility: TaskListVisibilityFilter): void => {
    if (this.#get().listVisibility === visibility) return;
    // Each visibility is its own list entry, so nothing needs clearing here.
    this.#set({ listVisibility: visibility }, false, 'setListVisibility');
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
      /**
       * "My tasks" board: the caller's own slice of the workspace, narrowed
       * server-side exactly like `useFetchMyTaskList` narrows its list.
       */
      scope?: 'assigned' | 'created';
    } = {},
  ): TaskCollectionSyncResult => {
    const {
      agentId,
      allAgents = false,
      automated,
      enabled = true,
      excludeStatuses,
      groupBy = 'status',
      projectId,
      scope,
    } = options;
    const hasScope = !!(scope || projectId || allAgents || agentId);
    const query: TaskGroupListQuery | undefined = hasScope
      ? {
          agentId: allAgents || scope ? undefined : agentId,
          automated,
          excludeStatuses: excludeStatuses?.length ? [...excludeStatuses].sort() : undefined,
          groupBy,
          projectId,
          scope,
          // "My tasks" is not offered the visibility chip and its list view
          // (`useFetchMyTaskList`) sends no visibility at all, so its board
          // ignores the chip too — otherwise a value left over from the
          // ordinary tab would change the row set on the list ↔ board switch.
          visibility: scope ? 'all' : this.#get().listVisibility,
        }
      : undefined;
    const queryKey = query ? taskGroupListQueryKey(query) : undefined;
    const sync = this.#taskGroupList.useSync(query, { enabled });
    return this.#toSyncResult(
      sync,
      enabled ? queryKey : undefined,
      !!queryKey && !!this.#get().taskGroupListMap[queryKey],
    );
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
  ): TaskCollectionSyncResult => {
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
    const hasScope = !!(projectId || allAgents || agentId);
    const query: TaskListQuery | undefined = hasScope
      ? {
          agentId: allAgents || projectId ? undefined : agentId,
          automated,
          complete: complete || undefined,
          orderBy,
          projectId,
          statuses: statuses?.length ? [...statuses].sort() : undefined,
          visibility: visibility ?? this.#get().listVisibility,
        }
      : undefined;
    const queryKey = query ? taskListQueryKey(query) : undefined;
    const sync = this.#taskList.useSync(query, { enabled });
    return this.#toSyncResult(
      sync,
      enabled ? queryKey : undefined,
      !!queryKey && !!this.#get().taskListMap[queryKey],
    );
  };
}

export type TaskListSliceAction = Pick<TaskListSliceActionImpl, keyof TaskListSliceActionImpl>;
