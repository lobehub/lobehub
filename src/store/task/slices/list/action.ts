import type { TaskCompletedWindow } from '@lobechat/builtin-tool-task';
import { normalizeTaskListFilter, type TaskListFilter, type TaskStatus } from '@lobechat/types';
import { useMemo } from 'react';

import { createReplicaSlice, recordLens, type ReplicaSyncResult } from '@/libs/replica';
import { taskService } from '@/services/task';
import type { StoreSetter } from '@/store/types';

import type { TaskStore } from '../../store';
import { useTaskStore } from '../../store';
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
 * `complete` mode paging. The server caps one `task.list` page at 500 rows, so
 * the full list is assembled from consecutive pages — sequential round trips,
 * so the page is as large as the server allows; the ceiling bounds the fan-out
 * for very large workspaces (2 requests) — past it the store keeps the real
 * `total` so the list can say it is showing a subset.
 */
export const COMPLETE_TASK_LIST_PAGE_SIZE = 500;

/** Page size of the Tasks page's paginated collections (scheduled, "My tasks"). */
export const TASK_COLLECTION_PAGE_SIZE = 50;

export interface ScheduledTaskListOptions {
  agentId?: string;
  /** The Tasks page filter; Home's roll-up sends none. */
  filter?: TaskListFilter;
  limit?: number;
  offset?: number;
  projectId?: string;
}

/**
 * The task-list query of one scheduled roll-up page. `agentId`/`projectId`
 * narrow it to a scoped Tasks page and are part of the key, so an agent's
 * schedules never render under another scope.
 */
export const scheduledTaskListQuery = ({
  agentId,
  filter,
  limit,
  offset,
  projectId,
}: ScheduledTaskListOptions): TaskListQuery => ({
  agentId: projectId ? undefined : agentId,
  automated: true,
  filter: normalizeTaskListFilter(filter),
  limit,
  offset,
  orderBy: 'updatedAt',
  projectId,
  visibility: 'all',
});
export const COMPLETE_TASK_LIST_MAX_ITEMS = 1000;

/**
 * A paginated collection (scheduled roll-up, "My tasks"): the task-list sync
 * plus the page in the `{ data, total }` shape of the list endpoint, undefined
 * until the entry is in the store (persisted or fetched) and while disabled.
 */
export interface TaskCollectionPageResult extends TaskCollectionSyncResult {
  data?: { data: TaskListValue['items']; total: number };
}

/** Sync result of a task list / board fetch: replica flags plus the SWR-era aliases. */
export interface TaskCollectionSyncResult extends ReplicaSyncResult {
  /** A request is in flight and there is nothing to show for this query yet. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
  /** Read the collection with `taskListSelectors.*(queryKey)`; undefined while disabled. */
  queryKey?: string;
}

/** What a batch overlay needs to know about the collection it patches. */
export interface CollectionQueryShape {
  /** The collection is one agent's tasks (assignee filter). */
  agentId?: string;
  /** The collection lists archived rows ("Show archived"); undefined when unknown. */
  includeArchived?: boolean;
  /** "My tasks" narrowing. */
  scope?: 'assigned' | 'created';
}

/** A batch overlay's patch of one task; `undefined` takes the row out of the collection. */
export type CollectionTasksPatch = (
  task: CollectionTask,
  query: CollectionQueryShape,
) => CollectionTask | undefined;

export interface CollectionTasksOptimistic {
  /** Keep the rows in `keep` (id → final patch; default: every id, original patch). */
  commit: (keep?: ReadonlyMap<string, CollectionTasksPatch>) => void;
  rollback: () => void;
}

/**
 * The query behind a list / board entry, read back from its key (the
 * canonical JSON `stableQueryKey` writes). A key that does not parse — or a
 * persisted row patched without its key — reports nothing.
 */
const collectionQueryShape = (queryKey?: string): CollectionQueryShape => {
  if (!queryKey) return {};
  try {
    const query = JSON.parse(queryKey) as {
      agentId?: unknown;
      includeArchived?: unknown;
      scope?: unknown;
    };
    return {
      agentId: typeof query?.agentId === 'string' ? query.agentId : undefined,
      includeArchived: query?.includeArchived === true,
      scope: query?.scope === 'assigned' || query?.scope === 'created' ? query.scope : undefined,
    };
  } catch {
    return {};
  }
};

type Setter = StoreSetter<TaskStore>;

export const createTaskListSlice = (set: Setter, get: () => TaskStore, _api?: unknown) =>
  new TaskListSliceActionImpl(set, get, _api);

export class TaskListSliceActionImpl {
  readonly #get: () => TaskStore;
  readonly #set: Setter;
  readonly #taskList;
  readonly #taskGroupList;

  constructor(set: Setter, get: () => TaskStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#taskList = createReplicaSlice(taskListResource, {
      actionPrefix: 'taskList',
      entity: taskListEntity,
      fetcher: (query) => this.#fetchList(query),
      get,
      merge: (incoming, _confirmed, query) => ({
        items: incoming.data,
        ...(query.statuses && { statuses: query.statuses }),
        total: incoming.total,
      }),
      set,
      stateKey: 'taskListReplica',
      view: recordLens<TaskStore, TaskListValue>('taskListMap'),
    });
    this.#taskGroupList = createReplicaSlice(taskGroupListResource, {
      actionPrefix: 'taskGroupList',
      entity: taskGroupListEntity,
      fetcher: (query) => this.#fetchGroups(query),
      get,
      merge: (incoming, _confirmed, query) => ({
        ...(query.excludeStatuses && { excludeStatuses: query.excludeStatuses }),
        groupBy: query.groupBy,
        groups: incoming.data,
      }),
      set,
      stateKey: 'taskGroupListReplica',
      view: recordLens<TaskStore, TaskGroupListValue>('taskGroupListMap'),
    });
  }

  #fetchList = (query: TaskListQuery) => {
    const params = {
      ...(query.agentId ? { assigneeAgentId: query.agentId } : {}),
      automated: query.automated,
      ...(query.completedWithin && { completedWithin: query.completedWithin }),
      ...(query.filter && { filter: query.filter }),
      includeArchived: query.includeArchived,
      orderBy: query.orderBy,
      projectId: query.projectId,
      ...(query.scope && { scope: query.scope }),
      statuses: query.statuses,
      visibility: filterToServerVisibility(query.visibility),
    };
    return query.complete
      ? this.fetchCompleteTaskList(params)
      : this.fetchTaskList({ ...params, limit: query.limit, offset: query.offset });
  };

  #fetchGroups = (query: TaskGroupListQuery) =>
    taskService.groupList({
      assigneeAgentId: query.agentId,
      ...(query.automated === undefined ? {} : { automated: query.automated }),
      ...(query.completedWithin && { completedWithin: query.completedWithin }),
      excludeStatuses: query.excludeStatuses,
      ...(query.filter && { filter: query.filter }),
      ...(query.groupBy === 'status'
        ? { groups: DEFAULT_KANBAN_GROUPS }
        : query.groupBy.startsWith('label:')
          ? { groupBy: 'label' as const, labelGroupId: query.groupBy.slice('label:'.length) }
          : { groupBy: query.groupBy as 'assignee' | 'member' | 'priority' }),
      includeArchived: query.includeArchived,
      projectId: query.projectId,
      scope: query.scope,
      visibility: filterToServerVisibility(query.visibility),
    });

  /** One page of a paginated collection, read reactively from its replica entry. */
  #useCollectionPage = (query: TaskListQuery, enabled: boolean): TaskCollectionPageResult => {
    const queryKey = taskListQueryKey(query);
    // A collection page is a deliberate view, not a live feed: no refetch on focus.
    const sync = this.#taskList.useSync(query, { enabled, revalidateOnFocus: false });
    const value = useTaskStore((s) => (enabled ? s.taskListMap[queryKey] : undefined));
    const data = useMemo(
      () => (value ? { data: value.items, total: value.total } : undefined),
      [value],
    );
    return { ...this.#toSyncResult(sync, enabled ? queryKey : undefined, !!value), data };
  };

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
  internal_findCollectionTask = (taskId: string): CollectionTask | undefined => {
    const { taskGroupListMap, taskListMap } = this.#get();
    for (const value of Object.values(taskListMap)) {
      const task = value.items.find((item) => item.id === taskId);
      if (task) return task;
    }
    for (const value of Object.values(taskGroupListMap)) {
      for (const group of value.groups) {
        const task = group.tasks.find((item) => item.id === taskId);
        if (task) return task;
      }
    }
    return undefined;
  };

  /**
   * Optimistic patch of a task in every loaded list and board (a status board
   * moves the card). `commit` keeps it as confirmed until the refresh lands and
   * applies the change to persisted lists and boards that are not loaded, so
   * reopening one later does not paint the old status; `rollback` restores
   * every loaded collection exactly, card order included.
   */
  internal_beginCollectionTaskOptimistic = (
    taskId: string,
    fn: <T extends CollectionTask>(task: T) => T,
  ) => {
    const tokens = [
      ...this.#taskList.beginEntityOptimistic<CollectionTask>(taskId, fn),
      ...this.#taskGroupList.beginEntityOptimistic<CollectionTask>(taskId, fn),
    ];
    return {
      commit: () => {
        tokens.forEach((token) => token.commit());
        void this.#taskList.patchStoredEntity<CollectionTask>(taskId, fn);
        void this.#taskGroupList.patchStoredEntity<CollectionTask>(taskId, fn);
      },
      rollback: () => tokens.forEach((token) => token.rollback()),
    };
  };

  /**
   * `internal_beginCollectionTaskOptimistic` for a whole selection (the list's
   * batch actions): ONE overlay per loaded list / board that holds any of
   * `ids`, applying `fn` to each of them — a 500-task batch is one store write
   * per collection, not one per task. `fn` returning `undefined` takes the row
   * out (delete, archive in a list that hides archived rows); it is told
   * whether the collection shows archived rows.
   *
   * `commit(keep)` settles with the rows the server actually changed: `keep`
   * maps those ids to their final patch (default: `fn` for every id), so a
   * failed or skipped row falls back to its confirmed value while the others
   * stay as shown until the refresh lands — persisted, unloaded lists and
   * boards get the same change. `rollback` restores every collection exactly.
   */
  internal_beginCollectionTasksOptimistic = (
    ids: readonly string[],
    fn: CollectionTasksPatch,
  ): CollectionTasksOptimistic => {
    const wanted = new Set(ids);
    const { taskGroupListMap, taskListMap } = this.#get();
    const applyTo =
      <TValue>(
        entity: {
          map: (data: TValue, id: string, fn: (task: any) => any) => TValue | undefined;
        },
        patches: ReadonlyMap<string, CollectionTasksPatch>,
        query: CollectionQueryShape,
      ) =>
      (data: TValue): TValue => {
        let next = data;
        for (const [id, patch] of patches) {
          // Task adapters drop a row, never the whole value; keep it if one did.
          next = entity.map(next, id, (task: CollectionTask) => patch(task, query)) ?? next;
        }
        return next;
      };
    const all = new Map(ids.map((id) => [id, fn] as const));

    const listKeys = Object.entries(taskListMap)
      .filter(([, value]) => value.items.some((task) => wanted.has(task.id)))
      .map(([key]) => key);
    const groupKeys = Object.entries(taskGroupListMap)
      .filter(([, value]) =>
        value.groups.some((group) => group.tasks.some((task) => wanted.has(task.id))),
      )
      .map(([key]) => key);

    const listTokens = listKeys.map((key) => ({
      key,
      token: this.#taskList.beginOptimistic(
        key,
        applyTo(taskListEntity, all, collectionQueryShape(key)),
      ),
    }));
    const groupTokens = groupKeys.map((key) => ({
      key,
      token: this.#taskGroupList.beginOptimistic(
        key,
        applyTo(taskGroupListEntity, all, collectionQueryShape(key)),
      ),
    }));

    let settled = false;
    return {
      commit: (keep = all) => {
        if (settled) return;
        settled = true;
        for (const { key, token } of listTokens)
          token.commit(applyTo(taskListEntity, keep, collectionQueryShape(key)));
        for (const { key, token } of groupTokens)
          token.commit(applyTo(taskGroupListEntity, keep, collectionQueryShape(key)));
        if (keep.size === 0) return;
        // Persisted lists and boards that are not loaded: one pass over the
        // stored rows per resource, whatever the selection size.
        void this.#taskList.patchStoredRows((data) =>
          applyTo(taskListEntity, keep, collectionQueryShape())(data),
        );
        void this.#taskGroupList.patchStoredRows((data) =>
          applyTo(taskGroupListEntity, keep, collectionQueryShape())(data),
        );
      },
      rollback: () => {
        if (settled) return;
        settled = true;
        for (const { token } of [...listTokens, ...groupTokens]) token.rollback();
      },
    };
  };

  /**
   * Optimistic overlay on one board (a drag between columns): shows now,
   * `commit` keeps it until the refresh lands, `rollback` restores the board.
   */
  internal_beginTaskGroupOptimistic = (
    queryKey: string,
    apply: (value: TaskGroupListValue) => TaskGroupListValue,
  ) => this.#taskGroupList.beginOptimistic(queryKey, apply);

  setActiveTaskListKey = (queryKey?: string, filtered?: boolean): void => {
    const state = this.#get();
    if (state.activeTaskListKey === queryKey && !!state.activeTaskListFiltered === !!filtered)
      return;
    this.#set(
      { activeTaskListFiltered: !!queryKey && !!filtered, activeTaskListKey: queryKey },
      false,
      'setActiveTaskListKey',
    );
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
      // That includes the scheduled roll-up and "My tasks" pages (a schedule
      // or an assignee can change on any edit) and the agent sidebar panels.
      this.#taskList.revalidate(),
      this.#taskGroupList.revalidate(),
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
      /** Keep completed / canceled cards only when closed within this window. */
      completedWithin?: TaskCompletedWindow;
      enabled?: boolean;
      excludeStatuses?: readonly TaskStatus[];
      /** The Tasks page filter; part of the key. */
      filter?: TaskListFilter;
      groupBy?: TaskKanbanGroupBy;
      includeArchived?: boolean;
      projectId?: string;
      /**
       * "My tasks" board: the caller's own slice of the workspace, narrowed
       * server-side exactly like `useFetchMyTaskList` narrows its list.
       */
      scope?: 'assigned' | 'created';
      /** Override the Task page's persisted filter for embedded consumers (the agent sidebar). */
      visibility?: TaskListVisibilityFilter;
    } = {},
  ): TaskCollectionSyncResult => {
    const {
      agentId,
      allAgents = false,
      automated,
      completedWithin,
      enabled = true,
      excludeStatuses,
      filter,
      groupBy = 'status',
      includeArchived,
      projectId,
      scope,
      visibility,
    } = options;
    // Subscribed, so flipping the visibility chip re-keys the board query.
    const listVisibility = useTaskStore((s) => s.listVisibility);
    const hasScope = !!(scope || projectId || allAgents || agentId);
    const query: TaskGroupListQuery | undefined = hasScope
      ? {
          agentId: allAgents || scope ? undefined : agentId,
          automated,
          completedWithin,
          excludeStatuses: excludeStatuses?.length ? [...excludeStatuses].sort() : undefined,
          filter: normalizeTaskListFilter(filter),
          groupBy,
          includeArchived: includeArchived || undefined,
          projectId,
          scope,
          // "My tasks" is not offered the visibility chip and its list view
          // (`useFetchMyTaskList`) sends no visibility at all, so its board
          // ignores the chip too — otherwise a value left over from the
          // ordinary tab would change the row set on the list ↔ board switch.
          visibility: scope ? 'all' : (visibility ?? listVisibility),
        }
      : undefined;
    const queryKey = query ? taskGroupListQueryKey(query) : undefined;
    // A board is a deliberate view, not a live feed: no refetch on focus.
    const sync = this.#taskGroupList.useSync(query, { enabled, revalidateOnFocus: false });
    return this.#toSyncResult(
      sync,
      enabled ? queryKey : undefined,
      !!queryKey && !!this.#get().taskGroupListMap[queryKey],
    );
  };

  /**
   * The automated-task roll-up behind Home's "Scheduled" section and the Tasks
   * page's scheduled tab. Each limit / offset is its own task-list entry
   * because Home and the paginated Tasks page can coexist in Electron.
   */
  useFetchScheduledTaskList = (
    options: ScheduledTaskListOptions & { enabled?: boolean } = {},
  ): TaskCollectionPageResult => {
    const { enabled = true, ...query } = options;
    return this.#useCollectionPage(scheduledTaskListQuery(query), enabled);
  };

  /**
   * Seed the persisted scheduled page before the route commits, so a reload
   * paints the local copy instead of the list's loading state. A later
   * `useSync` hydrate is a no-op once the slot is filled.
   */
  preHydrateScheduledTaskList = (options: ScheduledTaskListOptions): Promise<boolean> => {
    const scope = taskListResource.scope.get();
    this.#taskList.ensureScope(scope);
    return this.#taskList.hydrate(scheduledTaskListQuery(options), scope);
  };

  /**
   * The Tasks page's "My tasks" tab — the caller's own slice of the workspace
   * (`assigned` to them as a member, or `created` by them). Its own task-list
   * entries, never the ordinary tab's, so flipping the tab cannot leak one
   * collection into the other.
   */
  useFetchMyTaskList = (options: {
    /**
     * Server-side look-back for completed / canceled tasks (the "Completed
     * tasks" display option), cut before `limit` / `offset` like `statuses`.
     */
    completedWithin?: TaskCompletedWindow;
    enabled?: boolean;
    /** The Tasks page filter, applied before `limit` / `offset`. */
    filter?: TaskListFilter;
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
    scope: 'assigned' | 'created';
    /**
     * Server-side status narrowing (the "Completed tasks: None" display option
     * translated by `getVisibleTaskStatuses`). Applied before `limit` /
     * `offset` so a page can never come back empty while older unfinished
     * tasks exist; part of the query for the same reason as `scope`.
     */
    statuses?: TaskStatus[];
  }): TaskCollectionPageResult => {
    const {
      completedWithin,
      enabled = true,
      filter,
      includeArchived,
      limit,
      offset,
      scope,
      statuses,
    } = options;
    return this.#useCollectionPage(
      {
        completedWithin,
        filter: normalizeTaskListFilter(filter),
        // Archived rows are a different server page, like the status filter.
        includeArchived: includeArchived || undefined,
        limit,
        offset,
        orderBy: 'updatedAt',
        scope,
        statuses: statuses?.length ? [...statuses].sort() : undefined,
        // The tab offers no visibility chip and sends no visibility filter.
        visibility: 'all',
      },
      enabled,
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
      /** The Tasks page filter, applied server-side; part of the key. */
      filter?: TaskListFilter;
      /** Include archived tasks (the "Show archived" option); part of the key. */
      includeArchived?: boolean;
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
      filter,
      includeArchived,
      orderBy,
      projectId,
      statuses,
      visibility,
    } = options;
    // Subscribed, so flipping the visibility chip re-keys the list query.
    const listVisibility = useTaskStore((s) => s.listVisibility);
    const hasScope = !!(projectId || allAgents || agentId);
    const query: TaskListQuery | undefined = hasScope
      ? {
          agentId: allAgents || projectId ? undefined : agentId,
          automated,
          complete: complete || undefined,
          filter: normalizeTaskListFilter(filter),
          includeArchived: includeArchived || undefined,
          orderBy,
          projectId,
          statuses: statuses?.length ? [...statuses].sort() : undefined,
          visibility: visibility ?? listVisibility,
        }
      : undefined;
    const queryKey = query ? taskListQueryKey(query) : undefined;
    // No refetch on focus: a `complete` list walks up to two pages per sync.
    const sync = this.#taskList.useSync(query, { enabled, revalidateOnFocus: false });
    return this.#toSyncResult(
      sync,
      enabled ? queryKey : undefined,
      !!queryKey && !!this.#get().taskListMap[queryKey],
    );
  };
}

export type TaskListSliceAction = Pick<TaskListSliceActionImpl, keyof TaskListSliceActionImpl>;
