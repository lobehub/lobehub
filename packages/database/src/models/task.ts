import type {
  CheckpointConfig,
  NewTask,
  TaskItem,
  TaskSubtaskProgress,
  TaskVerifyConfig,
  WorkspaceData,
  WorkspaceDocNode,
  WorkspaceTreeNode,
} from '@lobechat/types';
import {
  and,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { merge } from '@/utils/merge';

import { documents } from '../schemas/file';
import type { NewTaskComment, TaskCommentItem } from '../schemas/task';
import { taskComments, taskDependencies, taskDocuments, tasks, taskTopics } from '../schemas/task';
import { topics } from '../schemas/topic';
import { acceptances } from '../schemas/verify';
import { works } from '../schemas/work';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

export const isTaskIdentifierUniqueViolation = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === 'object' && error && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  const cause = error instanceof Error ? error.cause : undefined;

  return (
    code === '23505' ||
    message.includes('23505') ||
    message.includes('duplicate') ||
    message.includes('unique') ||
    (!!cause && isTaskIdentifierUniqueViolation(cause))
  );
};

/**
 * Ownership helpers in this model come in three flavors. Choose by USE CASE,
 * not by table — picking the wrong one led to a `seq` allocation hotfix
 * (see git log).
 *
 * ┌────────────────────┬──────────────────────────────────────────────┬────────────────────────┐
 * │ Helper             │ Use for                                      │ Visibility-aware?      │
 * ├────────────────────┼──────────────────────────────────────────────┼────────────────────────┤
 * │ ownership()        │ list / read / per-row find on `tasks`        │ YES — public OR owner  │
 * │ ownershipSql()     │ raw-SQL CTEs that need the same predicate    │ YES — public OR owner  │
 * │ childOwnership()   │ task_dependencies / task_documents /         │ YES when caller passes │
 * │                    │ task_comments etc. (per-child-table)         │ the visibility column  │
 * │ seqOwnership()     │ identifier / seq allocation on `tasks`       │ NO — workspace-wide    │
 * │                    │ (the `(workspace_id, identifier)` unique     │ (visibility filter     │
 * │                    │ constraint is workspace-wide, regardless     │ would skip other       │
 * │                    │ of visibility)                               │ members' rows and      │
 * │                    │                                              │ collide on insert)     │
 * └────────────────────┴──────────────────────────────────────────────┴────────────────────────┘
 *
 * Personal mode (no workspace) is always `created_by_user_id = $self AND
 * workspace_id IS NULL` for all four helpers — visibility is inert because
 * everything personal is implicitly owner-only.
 */
/**
 * A task the automation runtime would still act on.
 *
 * `automation_mode` alone does not mean "this fires". The tick services refuse
 * to run on exactly these grounds — `scheduleTick` skips a schedule with no
 * cron pattern, `heartbeatTick` skips a heartbeat with no positive interval,
 * and both skip a task that has reached a terminal status. A row that keeps its
 * mode after being completed, canceled or stripped of its pattern is a
 * leftover, not a schedule, and listing it as one lets dead entries crowd real
 * ones out of a bounded roll-up.
 *
 * Kept as one expression so the `automated` filter's two sides stay exact
 * complements and no row falls into neither bucket.
 */
const RUNNABLE_AUTOMATION = and(
  notInArray(tasks.status, ['canceled', 'completed', 'failed']),
  or(
    and(
      eq(tasks.automationMode, 'schedule'),
      isNotNull(tasks.schedulePattern),
      ne(tasks.schedulePattern, ''),
    ),
    and(eq(tasks.automationMode, 'heartbeat'), gt(tasks.heartbeatInterval, 0)),
  ),
)!;

interface TaskListFilterOptions {
  assigneeAgentId?: string;
  /** Only tasks assigned to this workspace member. */
  assigneeUserId?: string;
  automated?: boolean;
  /** Only tasks created by this user. */
  createdByUserId?: string;
  parentTaskId?: string | null;
  projectId?: string;
  visibility?: 'private' | 'public';
}

interface TaskListOptions extends TaskListFilterOptions {
  /**
   * Keyset cursor: only rows that sort strictly after this `(orderBy, seq)`
   * position in the list's newest-first order. Unlike `offset`, a cursor is
   * unaffected by rows inserted or deleted ahead of it, so a client walking
   * the whole list page by page never repeats or skips a row.
   */
  after?: { at: Date; seq: number };
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'updatedAt';
  priorities?: number[];
  statuses?: string[];
}

interface TaskRunStats extends Record<string, unknown> {
  root_id: string;
  total_run_cost: number;
  total_run_duration: number;
}

interface TaskSubtaskProgressRow extends Record<string, unknown> {
  completed: number;
  root_id: string;
  total: number;
}

export class TaskModel {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  /**
   * Compat-mode ownership predicate for the `tasks` table — **visibility-aware**.
   * `tasks` uses `createdByUserId` instead of `userId`. Workspace mode applies
   * visibility-aware filtering: public tasks are visible to every member,
   * private tasks only to their creator. Use this for every list/read path.
   * For identifier / seq allocation, use `seqOwnership` instead.
   */
  private ownership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      {
        userId: tasks.createdByUserId,
        visibility: tasks.visibility,
        workspaceId: tasks.workspaceId,
      },
    );

  /**
   * Ownership predicate for task child tables (deps / docs / comments) that
   * use a `userId` column instead of `createdByUserId`. Pass `visibility` for
   * tables that mirror the parent task's visibility column; leave it omitted
   * for tables that stay workspace-shared (e.g. comments).
   */
  private childOwnership = (cols: {
    userId: AnyPgColumn;
    visibility?: AnyPgColumn;
    workspaceId: AnyPgColumn;
  }) => buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, cols);

  /**
   * Workspace-wide ownership for `tasks.seq` / `identifier` allocation —
   * must NOT be visibility-filtered. The `(workspace_id, identifier)` unique
   * constraint is workspace-scoped regardless of visibility, so seq lookups
   * have to see every row in the workspace; otherwise creators of private
   * tasks can collide on identifiers belonging to other members' rows.
   */
  private seqOwnership = () =>
    this.workspaceId
      ? eq(tasks.workspaceId, this.workspaceId)
      : (and(eq(tasks.createdByUserId, this.userId), isNull(tasks.workspaceId)) as SQL);

  /**
   * Raw-SQL ownership clause for use inside `db.execute(sql...)` CTEs that
   * can't easily compose with drizzle's `and(...)` helpers. Mirrors
   * `buildWorkspaceWhere` semantics:
   *   - workspace mode → `workspace_id = $ws AND (visibility = 'public' OR created_by_user_id = $userId)`
   *   - personal mode  → `created_by_user_id = $userId AND workspace_id IS NULL`
   */
  private ownershipSql = (alias?: string) => {
    const prefix = alias ? sql.raw(`${alias}.`) : sql.raw('');
    return this.workspaceId
      ? sql`${prefix}workspace_id = ${this.workspaceId}
            AND (${prefix}visibility = 'public' OR ${prefix}created_by_user_id = ${this.userId})`
      : sql`${prefix}created_by_user_id = ${this.userId} AND ${prefix}workspace_id IS NULL`;
  };

  private buildListConditions = ({
    assigneeAgentId,
    assigneeUserId,
    automated,
    createdByUserId,
    parentTaskId,
    projectId,
    visibility,
  }: TaskListFilterOptions): SQL[] => {
    const conditions = [this.ownership()];

    if (assigneeAgentId) conditions.push(eq(tasks.assigneeAgentId, assigneeAgentId));
    if (assigneeUserId) conditions.push(eq(tasks.assigneeUserId, assigneeUserId));
    if (createdByUserId) conditions.push(eq(tasks.createdByUserId, createdByUserId));
    if (automated === true) conditions.push(RUNNABLE_AUTOMATION);
    // `IS NOT TRUE`, not `NOT (…)`: nullable automation fields make the
    // runnable expression NULL for manual tasks, and WHERE would drop them.
    if (automated === false) conditions.push(sql`${RUNNABLE_AUTOMATION} IS NOT TRUE`);
    if (projectId) conditions.push(eq(tasks.projectId, projectId));
    if (visibility) conditions.push(eq(tasks.visibility, visibility));

    if (parentTaskId === null) {
      conditions.push(isNull(tasks.parentTaskId));
    } else if (parentTaskId) {
      conditions.push(eq(tasks.parentTaskId, parentTaskId));
    }

    return conditions;
  };

  /**
   * Look up a task's visibility so child-row inserts (deps, docs, topics) can
   * mirror it without forcing every call site to know the value. Defaults to
   * `'public'` if the task is missing (keeps inserts idempotent — the
   * onConflictDoNothing path stays valid).
   */
  private async getTaskVisibility(taskId: string): Promise<'private' | 'public'> {
    const row = await this.db
      .select({ visibility: tasks.visibility })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), this.ownership()))
      .limit(1);
    return row[0]?.visibility ?? 'public';
  }

  // ========== CRUD ==========

  async create(
    data: Omit<NewTask, 'id' | 'identifier' | 'seq' | 'createdByUserId'> & {
      identifierPrefix?: string;
    },
    options: { maxRetries?: number } = {},
  ): Promise<TaskItem> {
    const { identifierPrefix = 'T', ...rest } = data;

    // Retry loop to handle concurrent creates (parallel tool calls)
    const maxRetries = options.maxRetries ?? 5;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Seq is allocated per ownership scope: workspace-wide in team mode,
        // user-private in personal mode. This keeps `T-N` identifiers stable
        // within the surface the user actually sees.
        //
        // Note: this uses `seqOwnership` (visibility-blind), NOT the regular
        // `ownership()`, because the `(workspace_id, identifier)` unique
        // constraint is workspace-wide and ignores visibility. If we let the
        // seq lookup filter out private rows, a private creator would compute
        // a max seq that skips another member's existing identifier and hit
        // PG error 23505 on insert.
        const seqResult = await this.db
          .select({ maxSeq: sql<number>`COALESCE(MAX(${tasks.seq}), 0)` })
          .from(tasks)
          .where(this.seqOwnership());

        const nextSeq = Number(seqResult[0].maxSeq) + 1;
        const identifier = `${identifierPrefix}-${nextSeq}`;

        const [task] = await this.db
          .insert(tasks)
          .values({
            ...rest,
            createdByUserId: this.userId,
            identifier,
            seq: nextSeq,
            workspaceId: this.workspaceId ?? null,
          } as NewTask)
          .returning();

        return task;
      } catch (error: any) {
        // Retry on unique constraint violation (concurrent seq conflict)
        // Check error itself, cause, and stringified message for PG error code 23505
        if (isTaskIdentifierUniqueViolation(error) && attempt < maxRetries - 1) {
          continue;
        }
        throw error;
      }
    }

    throw new Error('Failed to create task after max retries');
  }

  async findById(id: string): Promise<TaskItem | null> {
    const result = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), this.ownership()))
      .limit(1);

    return result[0] || null;
  }

  async findByIds(ids: string[]): Promise<TaskItem[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(tasks)
      .where(and(inArray(tasks.id, ids), this.ownership()));
  }

  async resolveMany(idsOrIdentifiers: string[]): Promise<TaskItem[]> {
    if (idsOrIdentifiers.length === 0) return [];
    const identifiers = idsOrIdentifiers.map((value) => value.toUpperCase());
    return this.db
      .select()
      .from(tasks)
      .where(
        and(
          or(inArray(tasks.id, idsOrIdentifiers), inArray(tasks.identifier, identifiers)),
          this.ownership(),
        ),
      );
  }

  // Resolve id or identifier (e.g. 'T-1') to a task
  async resolve(idOrIdentifier: string): Promise<TaskItem | null> {
    if (idOrIdentifier.startsWith('task_')) return this.findById(idOrIdentifier);
    return this.findByIdentifier(idOrIdentifier.toUpperCase());
  }

  async findByIdentifier(identifier: string): Promise<TaskItem | null> {
    const result = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.identifier, identifier), this.ownership()))
      .limit(1);

    return result[0] || null;
  }

  async update(
    id: string,
    data: Partial<Omit<NewTask, 'id' | 'identifier' | 'seq' | 'createdByUserId'>>,
  ): Promise<TaskItem | null> {
    if (Object.keys(data).length === 0) return this.findById(id);

    const updated = await this.db
      .update(tasks)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(tasks.id, id), this.ownership()))
      .returning();
    return updated[0] || null;
  }

  /**
   * Delete a task. This does NOT touch the task's Work artifact: the Work
   * lifecycle is driven by the deleteTask tool call at the tool-execution
   * dispatch layer (which calls `WorkModel.deleteTaskWork`), so non-tool deletes
   * (UI / CLI / deleteAll) deliberately leave the Work as an orphan for the UI
   * to render as "resource deleted" from its version snapshot. See.
   */
  async delete(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(tasks)
      .where(and(eq(tasks.id, id), this.ownership()))
      .returning({ id: tasks.id });

    return deleted.length > 0;
  }

  /**
   * Move a task and its full subtree to a new visibility (both directions —
   * added the `public → private` demotion; the router gates who
   * may call it).
   *
   * Cascades inside a single transaction:
   *   - the root task and every descendant in `tasks`;
   *   - `task_dependencies` and `task_documents` whose `task_id` is in the set.
   *
   * `task_topics` and `task_comments` are direction-sensitive. Their
   * `visibility` column is a write-time mirror of the parent task used as a
   * JOIN-free authorization proxy, so:
   *   - `private → public` deliberately does **not** cascade them: promoting
   *     the task must not retroactively expose runs and discussions that
   *     happened while it was private. Rows created after promotion inherit
   *     the task's then-current visibility through their own create paths.
   *   - `public → private` **does** cascade them: leaving public-era rows
   *     public would let workspace members keep reading/operating historical
   *     topics and comments of a task they can no longer see.
   *
   * Returns `null` if the root task is not visible to the current caller
   * (either missing or owned by another workspace member). Callers should
   * gate authorization (creator-only / admin) before invoking this.
   */
  async updateVisibility(id: string, visibility: 'private' | 'public'): Promise<TaskItem | null> {
    const root = await this.findById(id);
    if (!root) return null;
    if (root.visibility === visibility) return root;

    const descendants = await this.findAllDescendants(root.id);
    const taskIds = [root.id, ...descendants.map((d) => d.id)];
    const stamp = new Date();

    return this.db.transaction(async (tx) => {
      // Update the root with RETURNING so we read the post-update row in the
      // same statement. A second SELECT filtered by `ownership()` would self-
      // cancel when a workspace owner demotes another member's task to private:
      // the UPDATE filter sees the OLD (public) row and writes, but the read-
      // back filter sees the NEW (private + other-creator) row and returns 0
      // rows, so the caller would observe a NOT_FOUND error even though the
      // write succeeded.
      const [updated] = await tx
        .update(tasks)
        .set({ updatedAt: stamp, visibility })
        .where(and(eq(tasks.id, root.id), this.ownership()))
        .returning();

      const descendantIds = descendants.map((d) => d.id);
      if (descendantIds.length > 0) {
        await tx
          .update(tasks)
          .set({ updatedAt: stamp, visibility })
          .where(and(inArray(tasks.id, descendantIds), this.ownership()));
      }

      await tx
        .update(taskDependencies)
        .set({ visibility })
        .where(and(inArray(taskDependencies.taskId, taskIds), this.depsOwnership()));

      await tx
        .update(taskDocuments)
        .set({ visibility })
        .where(and(inArray(taskDocuments.taskId, taskIds), this.docsOwnership()));

      // Work is a denormalized resource projection. Keep its indexed visibility
      // mirror in the same transaction as the task subtree so gallery/list
      // queries cannot observe a stale public row after demotion.
      await tx
        .update(works)
        .set({ visibility })
        .where(
          and(
            eq(works.resourceType, 'task'),
            inArray(works.resourceId, taskIds),
            buildWorkspaceWhere(
              { userId: this.userId, workspaceId: this.workspaceId },
              { userId: works.userId, workspaceId: works.workspaceId },
            ),
          ),
        );

      // Demotion-only cascade for the event-shaped child rows (see docstring):
      // their visibility mirrors the task, so pulling the task back to private
      // must also pull public-era topics/comments out of workspace scope.
      if (visibility === 'private') {
        await tx
          .update(taskTopics)
          .set({ visibility })
          .where(and(inArray(taskTopics.taskId, taskIds), this.topicsOwnership()));

        await tx
          .update(taskComments)
          .set({ visibility })
          .where(and(inArray(taskComments.taskId, taskIds), this.commentsOwnership()));
      }

      return updated ?? null;
    });
  }

  /**
   * Count workspace tasks that would break if the given agent were demoted to
   * private:
   *   - public tasks assigned to it — a public task must never reference a
   *     private agent (`assertAgentVisibilityCompat`);
   *   - tasks created by anyone other than the agent's owner (any visibility)
   *     — after demotion those creators can no longer resolve the assignee,
   *     so their runs and assignee updates fail.
   * Deliberately workspace-wide and visibility-blind (NOT `ownership()`):
   * other members' private tasks are invisible to the caller but still lose
   * their assignee. Backs the router-level agent demotion guard.
   */
  async countTasksBlockingAgentDemotion(
    assigneeAgentId: string,
    agentOwnerUserId: string,
  ): Promise<number> {
    if (!this.workspaceId) return 0;
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(tasks)
      .where(
        and(
          eq(tasks.workspaceId, this.workspaceId),
          eq(tasks.assigneeAgentId, assigneeAgentId),
          or(eq(tasks.visibility, 'public'), ne(tasks.createdByUserId, agentOwnerUserId)),
        ),
      );
    return Number(row?.count ?? 0);
  }

  /**
   * Whether the subtree rooted at `rootTaskId` (root excluded) contains tasks
   * created by someone other than `creatorUserId`. Deliberately workspace-wide
   * and visibility-blind: other members' private subtasks are invisible to the
   * caller but would still be fractured by a public→private demotion (each row
   * stays owned by its creator, so the root creator loses those descendants
   * while their creators keep orphaned children whose parent is hidden).
   * Backs the router-level task demotion guard.
   */
  async subtreeHasOtherCreators(rootTaskId: string, creatorUserId: string): Promise<boolean> {
    if (!this.workspaceId) return false;
    const result = await this.db.execute(sql`
      WITH RECURSIVE task_tree AS (
        SELECT id, created_by_user_id FROM tasks
          WHERE id = ${rootTaskId} AND workspace_id = ${this.workspaceId}
        UNION ALL
        SELECT t.id, t.created_by_user_id FROM tasks t
        JOIN task_tree tt ON t.parent_task_id = tt.id
      )
      SELECT 1 AS hit FROM task_tree
      WHERE id <> ${rootTaskId} AND created_by_user_id <> ${creatorUserId}
      LIMIT 1
    `);
    return result.rows.length > 0;
  }

  /** See {@link delete}: bulk task deletion likewise leaves Work artifacts intact. */
  async deleteAll(options?: { restrictToCreator?: boolean }): Promise<number> {
    // `restrictToCreator` narrows the workspace-wide sweep to rows the caller
    // created (non-owner members); owners/personal mode keep the full scope.
    const where = options?.restrictToCreator
      ? and(this.ownership(), eq(tasks.createdByUserId, this.userId))
      : this.ownership();

    const result = await this.db.delete(tasks).where(where).returning({ id: tasks.id });
    return result.length;
  }

  /** Delete a task and every descendant in one transaction. */
  async deleteSubtree(rootTaskId: string): Promise<number> {
    const descendants = await this.findAllDescendants(rootTaskId);
    const taskIds = [rootTaskId, ...descendants.map(({ id }) => id)];

    return this.db.transaction(async (tx) => {
      await tx
        .delete(acceptances)
        .where(
          and(
            eq(acceptances.subjectType, 'task'),
            inArray(acceptances.subjectId, taskIds),
            buildWorkspaceWhere(
              { userId: this.userId, workspaceId: this.workspaceId },
              { userId: acceptances.userId, workspaceId: acceptances.workspaceId },
            ),
          ),
        );
      const result = await tx
        .delete(tasks)
        .where(and(inArray(tasks.id, taskIds), this.ownership()))
        .returning({ id: tasks.id });

      return result.length;
    });
  }

  // ========== Query ==========

  async groupList(
    options: TaskListFilterOptions & {
      excludeStatuses?: string[];
      groupBy?: 'agent' | 'assignee' | 'member' | 'priority';
      groups?: Array<{
        key: string;
        limit?: number;
        offset?: number;
        statuses: string[];
      }>;
    },
  ): Promise<
    Array<{
      assigneeAgentId?: string | null;
      assigneeUserId?: string | null;
      hasMore: boolean;
      key: string;
      limit: number;
      offset: number;
      priority?: number;
      tasks: TaskItem[];
      total: number;
    }>
  > {
    const { assigneeAgentId, excludeStatuses, groupBy, groups } = options;

    if ((!groups || groups.length === 0) && !groupBy) {
      throw new Error('Task groups or a grouping dimension are required');
    }

    const baseConditions = this.buildListConditions(options);
    if (excludeStatuses?.length) {
      baseConditions.push(notInArray(tasks.status, excludeStatuses));
    }

    interface GroupQuery {
      assigneeAgentId?: string | null;
      assigneeUserId?: string | null;
      conditions: SQL[];
      key: string;
      limit: number;
      offset: number;
      prefetchedTasks?: TaskItem[];
      priority?: number;
      total: number;
    }

    let groupQueries: GroupQuery[];

    if (groupBy === 'assignee') {
      const limit = 50;
      const assigneeGroupKey = sql<string>`case
        when ${tasks.assigneeAgentId} is not null then 'assignee:' || ${tasks.assigneeAgentId}
        when ${tasks.assigneeUserId} is not null then 'assignee:user:' || ${tasks.assigneeUserId}
        else 'assignee:unassigned'
      end`;
      const rankedTasks = this.db
        .select({
          ...getTableColumns(tasks),
          assigneeGroupKey: assigneeGroupKey.as('assignee_group_key'),
          groupRank:
            sql<number>`row_number() over (partition by ${assigneeGroupKey} order by ${tasks.createdAt} desc, ${tasks.seq} desc)`.as(
              'group_rank',
            ),
        })
        .from(tasks)
        .where(and(...baseConditions))
        .as('ranked_assignee_tasks');
      const [countResult, rankedTaskRows] = await Promise.all([
        this.db
          .select({
            assigneeGroupKey: assigneeGroupKey.as('assignee_group_key'),
            count: sql<number>`count(*)`,
          })
          .from(tasks)
          .where(and(...baseConditions))
          .groupBy(assigneeGroupKey),
        this.db
          .select()
          .from(rankedTasks)
          .where(sql`${rankedTasks.groupRank} <= ${limit}`)
          .orderBy(rankedTasks.assigneeGroupKey, rankedTasks.groupRank),
      ]);
      const assigneeCounts = new Map(
        countResult.map((row) => [row.assigneeGroupKey, Number(row.count)]),
      );
      const tasksByAssignee = new Map<string, TaskItem[]>();
      for (const row of rankedTaskRows) {
        const { assigneeGroupKey: groupKey, groupRank: _groupRank, ...task } = row;
        const groupTasks = tasksByAssignee.get(groupKey) ?? [];
        groupTasks.push(task);
        tasksByAssignee.set(groupKey, groupTasks);
      }

      // `assignee` is the released hybrid grouping contract: agents take
      // precedence, member-only tasks get their own user group, and only tasks
      // with neither assignee are unassigned. New clients use `agent` for the
      // agent-only board instead of changing this existing API in place.
      if (!assigneeAgentId && !assigneeCounts.has('assignee:unassigned')) {
        assigneeCounts.set('assignee:unassigned', 0);
      }

      groupQueries = [...assigneeCounts.entries()].map(([key, total]) => {
        const isUnassigned = key === 'assignee:unassigned';
        const isUser = key.startsWith('assignee:user:');
        const groupAssigneeAgentId =
          isUnassigned || isUser
            ? isUnassigned
              ? null
              : undefined
            : key.slice('assignee:'.length);
        const groupAssigneeUserId = isUser
          ? key.slice('assignee:user:'.length)
          : isUnassigned
            ? null
            : undefined;
        const conditions = isUser
          ? [and(isNull(tasks.assigneeAgentId), eq(tasks.assigneeUserId, groupAssigneeUserId!))!]
          : isUnassigned
            ? [and(isNull(tasks.assigneeAgentId), isNull(tasks.assigneeUserId))!]
            : [eq(tasks.assigneeAgentId, groupAssigneeAgentId!)];

        return {
          assigneeAgentId: groupAssigneeAgentId,
          assigneeUserId: groupAssigneeUserId,
          conditions,
          key,
          limit,
          offset: 0,
          prefetchedTasks: tasksByAssignee.get(key) ?? [],
          total,
        };
      });
    } else if (groupBy === 'agent' || groupBy === 'member') {
      const limit = 50;
      const groupColumn = groupBy === 'agent' ? tasks.assigneeAgentId : tasks.assigneeUserId;
      const groupPrefix = groupBy === 'agent' ? 'assignee:' : 'member:';
      const unassignedKey = `${groupPrefix}unassigned`;
      const assigneeGroupKey = sql<string>`case
        when ${groupColumn} is not null then ${groupPrefix} || ${groupColumn}
        else ${unassignedKey}
      end`;
      const rankedTasks = this.db
        .select({
          ...getTableColumns(tasks),
          assigneeGroupKey: assigneeGroupKey.as('assignee_group_key'),
          groupRank:
            sql<number>`row_number() over (partition by ${assigneeGroupKey} order by ${tasks.createdAt} desc, ${tasks.seq} desc)`.as(
              'group_rank',
            ),
        })
        .from(tasks)
        .where(and(...baseConditions))
        .as('ranked_assignee_tasks');
      const [countResult, rankedTaskRows] = await Promise.all([
        this.db
          .select({
            assigneeId: groupColumn,
            count: sql<number>`count(*)`,
          })
          .from(tasks)
          .where(and(...baseConditions))
          .groupBy(groupColumn),
        this.db
          .select()
          .from(rankedTasks)
          .where(sql`${rankedTasks.groupRank} <= ${limit}`)
          .orderBy(rankedTasks.assigneeGroupKey, rankedTasks.groupRank),
      ]);
      const assigneeCounts = new Map(
        countResult.map((row) => [
          row.assigneeId ? `${groupPrefix}${row.assigneeId}` : unassignedKey,
          Number(row.count),
        ]),
      );
      const tasksByAssignee = new Map<string, TaskItem[]>();
      for (const row of rankedTaskRows) {
        const { assigneeGroupKey: groupKey, groupRank: _groupRank, ...task } = row;
        const groupTasks = tasksByAssignee.get(groupKey) ?? [];
        groupTasks.push(task);
        tasksByAssignee.set(groupKey, groupTasks);
      }

      // Keep an empty Unassigned column as a stable drop target. Agent-scoped
      // boards omit the Agent-unassigned column because their base filter
      // guarantees one assignee, while Member grouping remains independent.
      if ((groupBy === 'member' || !assigneeAgentId) && !assigneeCounts.has(unassignedKey)) {
        assigneeCounts.set(unassignedKey, 0);
      }

      groupQueries = [...assigneeCounts.entries()].map(([key, total]) => {
        const isUnassigned = key === unassignedKey;
        const assigneeId = isUnassigned ? null : key.slice(groupPrefix.length);
        const groupAssigneeAgentId = groupBy === 'agent' ? assigneeId : undefined;
        const groupAssigneeUserId = groupBy === 'member' ? assigneeId : undefined;
        const conditions = [isUnassigned ? isNull(groupColumn) : eq(groupColumn, assigneeId!)];

        return {
          assigneeAgentId: groupAssigneeAgentId,
          assigneeUserId: groupAssigneeUserId,
          conditions,
          key,
          limit,
          offset: 0,
          prefetchedTasks: tasksByAssignee.get(key) ?? [],
          total,
        };
      });
    } else if (groupBy === 'priority') {
      const priorities = [1, 2, 3, 4, 0];
      const countQuery = this.db
        .select({ count: sql<number>`count(*)`, priority: tasks.priority })
        .from(tasks)
        .where(and(...baseConditions))
        .groupBy(tasks.priority);
      const taskQueries = priorities.map(async (priority) => {
        const conditions = [
          priority === 0
            ? or(eq(tasks.priority, priority), isNull(tasks.priority))!
            : eq(tasks.priority, priority),
        ];
        const limit = 50;
        const offset = 0;
        const prefetchedTasks = await this.db
          .select()
          .from(tasks)
          .where(and(...baseConditions, ...conditions))
          .orderBy(desc(tasks.createdAt), desc(tasks.seq))
          .limit(limit)
          .offset(offset);

        return {
          conditions,
          key: `priority:${priority}`,
          limit,
          offset,
          prefetchedTasks,
          priority,
          total: 0,
        };
      });
      const [countResult, queriedGroups] = await Promise.all([
        countQuery,
        Promise.all(taskQueries),
      ]);
      const priorityCounts = new Map<number, number>();
      for (const row of countResult) {
        const priority = row.priority ?? 0;
        priorityCounts.set(priority, (priorityCounts.get(priority) ?? 0) + Number(row.count));
      }

      // Priority is a finite dimension, so include empty values as usable drop
      // targets. The order matches the task list's semantic rank.
      groupQueries = queriedGroups.map((group) => ({
        ...group,
        total: priorityCounts.get(group.priority) ?? 0,
      }));
    } else {
      const statusGroups = (groups ?? []).map((group) => ({
        ...group,
        statuses: Array.from(new Set(group.statuses)),
      }));
      const allStatuses = Array.from(new Set(statusGroups.flatMap((group) => group.statuses)));
      const countQuery = this.db
        .select({ count: sql<number>`count(*)`, status: tasks.status })
        .from(tasks)
        .where(and(...baseConditions, inArray(tasks.status, allStatuses)))
        .groupBy(tasks.status);
      const taskQueries = statusGroups.map(async (group) => {
        const conditions = [inArray(tasks.status, group.statuses)];
        const limit = group.limit ?? 50;
        const offset = group.offset ?? 0;
        const prefetchedTasks = await this.db
          .select()
          .from(tasks)
          .where(and(...baseConditions, ...conditions))
          .orderBy(desc(tasks.createdAt), desc(tasks.seq))
          .limit(limit)
          .offset(offset);

        return {
          conditions,
          key: group.key,
          limit,
          offset,
          prefetchedTasks,
          statuses: group.statuses,
          total: 0,
        };
      });
      const [countResult, queriedGroups] = await Promise.all([
        countQuery,
        Promise.all(taskQueries),
      ]);
      const countByStatus = new Map(countResult.map((row) => [row.status, Number(row.count)]));

      groupQueries = queriedGroups.map(({ statuses, ...group }) => ({
        ...group,
        total: statuses.reduce((sum, status) => sum + (countByStatus.get(status) ?? 0), 0),
      }));
    }

    const results = await Promise.all(
      groupQueries.map(async (group) => {
        const groupTasks =
          group.prefetchedTasks ??
          (await this.db
            .select()
            .from(tasks)
            .where(and(...baseConditions, ...group.conditions))
            .orderBy(desc(tasks.createdAt), desc(tasks.seq))
            .limit(group.limit)
            .offset(group.offset));

        return {
          ...(group.assigneeAgentId !== undefined
            ? { assigneeAgentId: group.assigneeAgentId }
            : {}),
          ...(group.assigneeUserId !== undefined ? { assigneeUserId: group.assigneeUserId } : {}),
          hasMore: group.offset + groupTasks.length < group.total,
          key: group.key,
          limit: group.limit,
          offset: group.offset,
          ...(group.priority !== undefined ? { priority: group.priority } : {}),
          tasks: groupTasks,
          total: group.total,
        };
      }),
    );

    const taskIds = Array.from(
      new Set(results.flatMap((group) => group.tasks.map(({ id }) => id))),
    );
    const [runStats, subtaskProgressByTaskId] = await Promise.all([
      this.runStatsByTaskIds(taskIds),
      this.subtaskProgressByTaskIds(taskIds),
    ]);
    const runStatsByTaskId = new Map(
      runStats.map((stats) => [
        stats.root_id,
        {
          totalRunCost: Number(stats.total_run_cost),
          totalRunDuration: Number(stats.total_run_duration),
        },
      ]),
    );

    return results.map((group) => ({
      ...group,
      tasks: group.tasks.map((task) => ({
        ...task,
        subtaskProgress: subtaskProgressByTaskId.get(task.id),
        totalRunCost: runStatsByTaskId.get(task.id)?.totalRunCost ?? 0,
        totalRunDuration: runStatsByTaskId.get(task.id)?.totalRunDuration ?? 0,
      })),
    }));
  }

  private async runStatsByTaskIds(taskIds: string[]): Promise<TaskRunStats[]> {
    if (taskIds.length === 0) return [];

    const result = await this.db.execute<TaskRunStats>(sql`
      WITH RECURSIVE goal_tree AS (
        SELECT ${tasks.id} AS root_id, ${tasks.id} AS task_id
        FROM ${tasks}
        WHERE ${inArray(tasks.id, taskIds)} AND ${this.ownership()}
        UNION ALL
        SELECT goal_tree.root_id, child.id
        FROM ${tasks} child
        JOIN goal_tree ON child.parent_task_id = goal_tree.task_id
        WHERE ${this.ownershipSql('child')}
      )
      SELECT
        goal_tree.root_id,
        coalesce(sum(${topics.totalCost}), 0) AS total_run_cost,
        coalesce(
          sum(extract(epoch from (${topics.completedAt} - ${taskTopics.createdAt})) * 1000)
            filter (where ${topics.completedAt} is not null),
          0
        ) AS total_run_duration
      FROM goal_tree
      LEFT JOIN ${taskTopics} ON ${taskTopics.taskId} = goal_tree.task_id
      LEFT JOIN ${topics} ON ${topics.id} = ${taskTopics.topicId}
      GROUP BY goal_tree.root_id
    `);

    return result.rows;
  }

  private async subtaskProgressByTaskIds(
    taskIds: string[],
  ): Promise<Map<string, TaskSubtaskProgress>> {
    if (taskIds.length === 0) return new Map();

    const result = await this.db.execute<TaskSubtaskProgressRow>(sql`
      WITH RECURSIVE task_tree AS (
        SELECT ${tasks.id} AS root_id, ${tasks.id} AS task_id, ${tasks.status} AS status
        FROM ${tasks}
        WHERE ${inArray(tasks.id, taskIds)} AND ${this.ownership()}
        UNION ALL
        SELECT task_tree.root_id, child.id, child.status
        FROM ${tasks} child
        JOIN task_tree ON child.parent_task_id = task_tree.task_id
        WHERE ${this.ownershipSql('child')}
      )
      SELECT
        task_tree.root_id,
        count(*) filter (
          where task_tree.task_id <> task_tree.root_id and task_tree.status = 'completed'
        ) AS completed,
        count(*) filter (where task_tree.task_id <> task_tree.root_id) AS total
      FROM task_tree
      GROUP BY task_tree.root_id
    `);

    return new Map(
      result.rows.map((progress) => [
        progress.root_id,
        { completed: Number(progress.completed), total: Number(progress.total) },
      ]),
    );
  }

  async list(options: TaskListOptions = {}): Promise<{ tasks: TaskItem[]; total: number }> {
    const { after, statuses, priorities, limit = 50, offset = 0, orderBy = 'createdAt' } = options;
    const orderColumn = orderBy === 'updatedAt' ? tasks.updatedAt : tasks.createdAt;

    const conditions = this.buildListConditions(options);

    if (statuses?.length) conditions.push(inArray(tasks.status, statuses));
    if (priorities?.length) conditions.push(inArray(tasks.priority, priorities));
    if (after) {
      conditions.push(
        or(
          lt(orderColumn, after.at),
          and(eq(orderColumn, after.at), lt(tasks.seq, after.seq)),
        ) as SQL,
      );
    }

    const where = and(...conditions);

    const countQuery = this.db
      .select({ count: sql<number>`count(*)` })
      .from(tasks)
      .where(where);

    const taskListQuery = this.db
      .select()
      .from(tasks)
      .where(where)
      // `seq` breaks timestamp ties so the order is total — required for the
      // keyset cursor above and for offset pages to never repeat or skip a row.
      .orderBy(desc(orderColumn), desc(tasks.seq))
      .limit(limit)
      .offset(offset);
    const [countResult, taskList] = await Promise.all([countQuery, taskListQuery]);
    const subtaskProgressByTaskId = await this.subtaskProgressByTaskIds(
      taskList.map(({ id }) => id),
    );

    return {
      tasks: taskList.map((task) => ({
        ...task,
        subtaskProgress: subtaskProgressByTaskId.get(task.id),
      })),
      total: Number(countResult[0].count),
    };
  }

  /**
   * Batch update sortOrder for multiple tasks.
   * @param order Array of { id, sortOrder } pairs
   */
  async reorder(order: Array<{ id: string; sortOrder: number }>): Promise<void> {
    for (const item of order) {
      await this.db
        .update(tasks)
        .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
        .where(and(eq(tasks.id, item.id), this.ownership()));
    }
  }

  async findSubtasks(parentTaskId: string): Promise<TaskItem[]> {
    return this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.parentTaskId, parentTaskId), this.ownership()))
      .orderBy(tasks.sortOrder, tasks.seq);
  }

  /**
   * Fetch all descendants of a root task using Drizzle select() (returns camelCase fields).
   * Uses breadth-first traversal with O(depth) queries.
   */
  async findAllDescendants(rootTaskId: string): Promise<TaskItem[]> {
    const all: TaskItem[] = [];
    let parentIds = [rootTaskId];

    while (parentIds.length > 0) {
      const children = await this.db
        .select()
        .from(tasks)
        .where(and(inArray(tasks.parentTaskId, parentIds), this.ownership()))
        .orderBy(tasks.sortOrder, tasks.seq);

      if (children.length === 0) break;

      all.push(...children);
      parentIds = children.map((c) => c.id);
    }

    return all;
  }

  // Recursive query to get full task tree
  async getTaskTree(rootTaskId: string): Promise<TaskItem[]> {
    const ownership = this.ownershipSql();
    const result = await this.db.execute(sql`
      WITH RECURSIVE task_tree AS (
        SELECT * FROM tasks WHERE id = ${rootTaskId} AND ${ownership}
        UNION ALL
        SELECT t.* FROM tasks t
        JOIN task_tree tt ON t.parent_task_id = tt.id
      )
      SELECT * FROM task_tree
    `);

    return result.rows as unknown as TaskItem[];
  }

  /**
   * For a list of task IDs, find all agent IDs (assignee + creator) across their full task trees.
   * Walks UP to find root, then DOWN to collect all agents.
   * Returns { [inputTaskId]: agentId[] }
   */
  async getTreeAgentIdsForTaskIds(taskIds: string[]): Promise<Record<string, string[]>> {
    if (taskIds.length === 0) return {};

    const taskIdParams = taskIds.map((id) => sql`${id}`);
    const taskIdList = sql.join(taskIdParams, sql`, `);

    const ownershipBare = this.ownershipSql();
    const ownershipAliased = this.ownershipSql('t');
    const result = await this.db.execute(sql`
      WITH RECURSIVE
      ancestors AS (
        SELECT id AS origin_id, id, parent_task_id
        FROM tasks
        WHERE id IN (${taskIdList})
          AND ${ownershipBare}
        UNION ALL
        SELECT a.origin_id, t.id, t.parent_task_id
        FROM tasks t
        JOIN ancestors a ON t.id = a.parent_task_id
        WHERE ${ownershipAliased}
      ),
      roots AS (
        SELECT DISTINCT ON (origin_id) origin_id, id AS root_id
        FROM ancestors
        WHERE parent_task_id IS NULL
      ),
      descendants AS (
        SELECT r.origin_id, t.id, t.assignee_agent_id, t.created_by_agent_id
        FROM tasks t
        JOIN roots r ON t.id = r.root_id
        WHERE ${ownershipAliased}
        UNION ALL
        SELECT d.origin_id, t.id, t.assignee_agent_id, t.created_by_agent_id
        FROM tasks t
        JOIN descendants d ON t.parent_task_id = d.id
        WHERE ${ownershipAliased}
      )
      SELECT origin_id, assignee_agent_id, created_by_agent_id
      FROM descendants
      WHERE assignee_agent_id IS NOT NULL OR created_by_agent_id IS NOT NULL
    `);

    const map: Record<string, Set<string>> = {};
    for (const row of result.rows as any[]) {
      const originId = row.origin_id as string;
      if (!map[originId]) map[originId] = new Set();
      if (row.assignee_agent_id) map[originId].add(row.assignee_agent_id as string);
      if (row.created_by_agent_id) map[originId].add(row.created_by_agent_id as string);
    }

    return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, Array.from(v)]));
  }

  // ========== Status ==========

  async updateStatus(
    id: string,
    status: string,
    extra?: { completedAt?: Date; error?: string | null; startedAt?: Date },
  ): Promise<TaskItem | null> {
    return this.update(id, { status, ...extra });
  }

  /** Atomically transition a task only while it still has the expected status. */
  async updateStatusIfCurrent(
    id: string,
    currentStatus: string,
    status: string,
    extra?: { completedAt?: Date; error?: string | null; startedAt?: Date },
  ): Promise<TaskItem | null> {
    const [task] = await this.db
      .update(tasks)
      .set({ status, updatedAt: new Date(), ...extra })
      .where(and(eq(tasks.id, id), eq(tasks.status, currentStatus), this.ownership()))
      .returning();

    return task ?? null;
  }

  async batchUpdateStatus(ids: string[], status: string): Promise<number> {
    const result = await this.db
      .update(tasks)
      .set({ status, updatedAt: new Date() })
      .where(and(inArray(tasks.id, ids), this.ownership()))
      .returning();

    return result.length;
  }

  // ========== Config ==========

  /**
   * Safely merge-update the task's config object.
   * Reads the current config, shallow-merges the incoming partial, and writes back.
   */
  async updateTaskConfig(id: string, partial: Record<string, unknown>): Promise<TaskItem | null> {
    const task = await this.findById(id);
    if (!task) return null;

    const current = (task.config as Record<string, unknown>) || {};
    const config = merge(current, partial);
    return this.update(id, { config });
  }

  // ========== Context (runtime state) ==========

  /**
   * Deep-merge into the task's context JSONB. Used by the heartbeat scheduler
   * to update `context.scheduler.{tickMessageId, consecutiveFailures, ...}`
   * without disturbing other namespaces under context.
   */
  async updateContext(id: string, partial: Record<string, unknown>): Promise<TaskItem | null> {
    const task = await this.findById(id);
    if (!task) return null;

    const current = (task.context as Record<string, unknown>) || {};
    const context = merge(current, partial);
    return this.update(id, { context });
  }

  // ========== Checkpoint ==========

  getCheckpointConfig(task: TaskItem): CheckpointConfig {
    return (task.config as Record<string, any>)?.checkpoint || {};
  }

  async updateCheckpointConfig(id: string, checkpoint: CheckpointConfig): Promise<TaskItem | null> {
    return this.updateTaskConfig(id, { checkpoint });
  }

  // ========== Review Config ==========

  getReviewConfig(task: TaskItem): Record<string, any> | undefined {
    return (task.config as Record<string, any>)?.review;
  }

  async updateReviewConfig(id: string, review: Record<string, any>): Promise<TaskItem | null> {
    return this.updateTaskConfig(id, { review });
  }

  // ========== Verify Config ==========

  /**
   * Read this task's own verify config from `config.verify`. During the
   * migration window it falls back to the legacy `config.review` key so tasks
   * configured before the verify cutover still surface their gate settings —
   * only the shared `enabled` / `maxIterations` fields carry over (review's
   * inline rubrics are dropped, no data was using them).
   */
  getVerifyConfig(task: TaskItem): TaskVerifyConfig | undefined {
    const config = task.config as Record<string, any> | undefined;
    if (config?.verify) return config.verify as TaskVerifyConfig;

    const review = config?.review as Record<string, any> | undefined;
    if (review && (review.enabled !== undefined || review.maxIterations !== undefined)) {
      return { enabled: review.enabled, maxIterations: review.maxIterations };
    }
    return undefined;
  }

  /**
   * Resolve the effective verify config for a task, honoring subtask
   * inheritance. Whole-config override semantics: the task uses its own config
   * when it has one, otherwise it walks up `parentTaskId` and adopts the
   * nearest ancestor's config in full (never a field-level merge of the two).
   * Returns `undefined` when no task in the chain has a verify config.
   */
  async resolveVerifyConfig(taskId: string): Promise<TaskVerifyConfig | undefined> {
    const seen = new Set<string>();
    let currentId: string | null = taskId;

    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      const task = await this.findById(currentId);
      if (!task) break;

      const config = this.getVerifyConfig(task);
      if (config) return config;

      currentId = task.parentTaskId;
    }
    return undefined;
  }

  /**
   * Patch the task's own `config.verify`. Per-key semantics (a plain deep-merge
   * can't express "remove", and JSON can't transmit `undefined`):
   * - `null`      → clear the key (e.g. switch a rubric/verifier back to default)
   * - omitted     → leave the existing value untouched
   * - any value   → set it (arrays replace wholesale, not index-merged)
   *
   * The merge is scoped to the `verify` sub-object so sibling config keys
   * (model, checkpoint, schedule, …) are preserved.
   */
  async updateVerifyConfig(
    id: string,
    patch: { [K in keyof TaskVerifyConfig]?: TaskVerifyConfig[K] | null },
  ): Promise<TaskItem | null> {
    const task = await this.findById(id);
    if (!task) return null;

    const config = (task.config as Record<string, any>) || {};
    const next: Record<string, any> = { ...(config.verify as TaskVerifyConfig | undefined) };

    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete next[key];
      else if (value !== undefined) next[key] = value;
    }

    return this.update(id, { config: { ...config, verify: next } });
  }

  // Check if a task should pause after a topic completes
  // Default: pause (when no checkpoint config is set)
  // Explicit: pause only if topic.after is true
  shouldPauseOnTopicComplete(task: TaskItem): boolean {
    const checkpoint = this.getCheckpointConfig(task);
    const hasAnyConfig = Object.keys(checkpoint).length > 0;
    return hasAnyConfig ? !!checkpoint.topic?.after : true;
  }

  // Check if a task should be paused before starting (parent's tasks.beforeIds)
  shouldPauseBeforeStart(parentTask: TaskItem, childIdentifier: string): boolean {
    const checkpoint = this.getCheckpointConfig(parentTask);
    return checkpoint.tasks?.beforeIds?.includes(childIdentifier) ?? false;
  }

  // Check if a task should be paused after completing (parent's tasks.afterIds)
  shouldPauseAfterComplete(parentTask: TaskItem, childIdentifier: string): boolean {
    const checkpoint = this.getCheckpointConfig(parentTask);
    return checkpoint.tasks?.afterIds?.includes(childIdentifier) ?? false;
  }

  // ========== Heartbeat ==========

  async updateHeartbeat(id: string): Promise<void> {
    await this.db
      .update(tasks)
      .set({ lastHeartbeatAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tasks.id, id), this.ownership()));
  }

  // Tasks eligible for cron-based dispatch.
  // Excludes terminal/paused/running — `paused` requires user attention,
  // `running` is already in flight (and `runTask` would CONFLICT anyway).
  static async getScheduledTasks(db: LobeChatDatabase): Promise<TaskItem[]> {
    return db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.automationMode, 'schedule'),
          isNotNull(tasks.schedulePattern),
          notInArray(tasks.status, ['canceled', 'completed', 'failed', 'paused', 'running']),
        ),
      );
  }

  // Find stuck tasks (running but heartbeat timed out)
  // Only checks tasks that have both lastHeartbeatAt and heartbeatTimeout set
  static async findStuckTasks(db: LobeChatDatabase): Promise<TaskItem[]> {
    return db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.status, 'running'),
          isNotNull(tasks.lastHeartbeatAt),
          isNotNull(tasks.heartbeatTimeout),
          sql`${tasks.lastHeartbeatAt} < now() - make_interval(secs => ${tasks.heartbeatTimeout})`,
        ),
      );
  }

  // ========== Dependencies ==========

  private depsOwnership = () =>
    this.childOwnership({
      userId: taskDependencies.userId,
      visibility: taskDependencies.visibility,
      workspaceId: taskDependencies.workspaceId,
    });

  /** Only used by the demotion cascade in {@link updateVisibility} — regular
   *  taskTopics reads/writes live in `TaskTopicModel`. */
  private topicsOwnership = () =>
    this.childOwnership({
      userId: taskTopics.userId,
      visibility: taskTopics.visibility,
      workspaceId: taskTopics.workspaceId,
    });

  async addDependency(taskId: string, dependsOnId: string, type: string = 'blocks'): Promise<void> {
    const dependencyTasks = await this.findByIds([taskId, dependsOnId]);
    const task = dependencyTasks.find(({ id }) => id === taskId);
    const dependsOn = dependencyTasks.find(({ id }) => id === dependsOnId);
    if (!task || !dependsOn) throw new Error('Task not found');
    if (task.projectId !== dependsOn.projectId && (task.projectId || dependsOn.projectId)) {
      throw new Error('Task dependencies cannot cross project boundaries');
    }

    const visibility = await this.getTaskVisibility(taskId);
    await this.db
      .insert(taskDependencies)
      .values({
        dependsOnId,
        taskId,
        type,
        userId: this.userId,
        visibility,
        workspaceId: this.workspaceId ?? null,
      })
      .onConflictDoNothing();
  }

  async removeDependency(taskId: string, dependsOnId: string): Promise<void> {
    await this.db
      .delete(taskDependencies)
      .where(
        and(
          eq(taskDependencies.taskId, taskId),
          eq(taskDependencies.dependsOnId, dependsOnId),
          this.depsOwnership(),
        ),
      );
  }

  async getDependencies(taskId: string) {
    return this.db
      .select()
      .from(taskDependencies)
      .where(and(eq(taskDependencies.taskId, taskId), this.depsOwnership()));
  }

  async getDependenciesByTaskIds(taskIds: string[]) {
    if (taskIds.length === 0) return [];
    return this.db
      .select()
      .from(taskDependencies)
      .where(and(inArray(taskDependencies.taskId, taskIds), this.depsOwnership()));
  }

  async getDependents(taskId: string) {
    return this.db
      .select()
      .from(taskDependencies)
      .where(and(eq(taskDependencies.dependsOnId, taskId), this.depsOwnership()));
  }

  // Check if all dependencies of a task are completed
  async areAllDependenciesCompleted(taskId: string): Promise<boolean> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(taskDependencies)
      .innerJoin(tasks, eq(taskDependencies.dependsOnId, tasks.id))
      .where(
        and(
          eq(taskDependencies.taskId, taskId),
          eq(taskDependencies.type, 'blocks'),
          ne(tasks.status, 'completed'),
          this.depsOwnership(),
        ),
      );

    return Number(result[0].count) === 0;
  }

  // Find tasks that are now unblocked after a dependency completes
  async getUnlockedTasks(completedTaskId: string): Promise<TaskItem[]> {
    // Find all tasks that depend on the completed task
    const dependents = await this.getDependents(completedTaskId);
    const unlocked: TaskItem[] = [];

    for (const dep of dependents) {
      if (dep.type !== 'blocks') continue;

      // Check if ALL dependencies of this task are now completed
      const allDone = await this.areAllDependenciesCompleted(dep.taskId);
      if (!allDone) continue;

      // Get the task itself — only unlock if it's in backlog
      const task = await this.findById(dep.taskId);
      if (task && task.status === 'backlog') {
        unlocked.push(task);
      }
    }

    return unlocked;
  }

  // Check if all subtasks of a parent task are completed
  async areAllSubtasksCompleted(parentTaskId: string): Promise<boolean> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(tasks)
      .where(
        and(eq(tasks.parentTaskId, parentTaskId), ne(tasks.status, 'completed'), this.ownership()),
      );

    return Number(result[0].count) === 0;
  }

  // ========== Documents (MVP Workspace) ==========

  private docsOwnership = () =>
    this.childOwnership({
      userId: taskDocuments.userId,
      visibility: taskDocuments.visibility,
      workspaceId: taskDocuments.workspaceId,
    });

  async pinDocument(taskId: string, documentId: string, pinnedBy: string = 'agent'): Promise<void> {
    const visibility = await this.getTaskVisibility(taskId);
    await this.db
      .insert(taskDocuments)
      .values({
        documentId,
        pinnedBy,
        taskId,
        userId: this.userId,
        visibility,
        workspaceId: this.workspaceId ?? null,
      })
      .onConflictDoNothing();
  }

  async unpinDocument(taskId: string, documentId: string): Promise<void> {
    await this.db
      .delete(taskDocuments)
      .where(
        and(
          eq(taskDocuments.taskId, taskId),
          eq(taskDocuments.documentId, documentId),
          this.docsOwnership(),
        ),
      );
  }

  async getPinnedDocuments(taskId: string) {
    return this.db
      .select()
      .from(taskDocuments)
      .where(and(eq(taskDocuments.taskId, taskId), this.docsOwnership()))
      .orderBy(taskDocuments.createdAt);
  }

  /**
   * Documents pinned to a task at or after a given timestamp, joined with the
   * `documents` table so callers receive `{ id, kind, title }` directly.
   *
   * Used by topic-brief synthesis to attribute artifacts to the topic that
   * just completed: pass the topic's start time as `since`.
   */
  async getDocumentsPinnedSince(
    taskId: string,
    since: Date,
  ): Promise<{ id: string; kind: string | null; title: string | null }[]> {
    const rows = await this.db
      .select({
        fileType: documents.fileType,
        id: documents.id,
        title: documents.title,
      })
      .from(taskDocuments)
      // Guard the referenced document too: the junction's visibility column is
      // a write-time mirror of the TASK, so a document independently switched
      // back to private would otherwise still leak its title here.
      .innerJoin(
        documents,
        and(
          eq(taskDocuments.documentId, documents.id),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, documents),
        ),
      )
      .where(
        and(
          eq(taskDocuments.taskId, taskId),
          this.docsOwnership(),
          gte(taskDocuments.createdAt, since),
        ),
      );

    return rows.map((row) => ({
      id: row.id,
      kind: row.fileType ?? null,
      title: row.title ?? null,
    }));
  }

  // Get all pinned docs from a task tree (recursive), returns nodeMap + tree structure
  async getTreePinnedDocuments(rootTaskId: string): Promise<WorkspaceData> {
    const rootOwnership = this.ownershipSql();
    const recursiveOwnership = this.ownershipSql('t');
    const docsOwnership = this.workspaceId
      ? sql`td.workspace_id = ${this.workspaceId}
            AND (td.visibility = 'public' OR td.user_id = ${this.userId})`
      : sql`td.user_id = ${this.userId} AND td.workspace_id IS NULL`;
    // Guard the referenced document row itself: `td.visibility` is a
    // write-time mirror of the TASK's visibility, so a document independently
    // switched back to private would otherwise still leak its title/metadata
    // through this join. A guarded-out document keeps its junction row but
    // joins as NULL → surfaced as an inaccessible tombstone node.
    const documentVisibility = this.workspaceId
      ? sql`d.workspace_id = ${this.workspaceId}
            AND (d.visibility IS NULL OR d.visibility = 'public' OR d.user_id = ${this.userId})`
      : sql`d.user_id = ${this.userId} AND d.workspace_id IS NULL`;
    const result = await this.db.execute(sql`
      WITH RECURSIVE task_tree AS (
        SELECT id, identifier FROM tasks WHERE id = ${rootTaskId} AND ${rootOwnership}
        UNION ALL
        SELECT t.id, t.identifier FROM tasks t
        JOIN task_tree tt ON t.parent_task_id = tt.id
        WHERE ${recursiveOwnership}
      )
      SELECT td.*, tt.id as source_task_id, tt.identifier as source_task_identifier,
             d.id as document_ref_id,
             d.title as document_title, d.file_type as document_file_type, d.parent_id as document_parent_id,
             d.total_char_count as document_char_count, d.updated_at as document_updated_at
      FROM task_documents td
      JOIN task_tree tt ON td.task_id = tt.id
      LEFT JOIN documents d ON td.document_id = d.id AND ${documentVisibility}
      WHERE ${docsOwnership}
      ORDER BY td.created_at
    `);

    // Build nodeMap
    const nodeMap: Record<string, WorkspaceDocNode> = {};

    const docIds = new Set<string>();

    for (const row of result.rows as any[]) {
      const docId = row.document_id;
      // Join miss = the viewer lost access to the document (switched back to
      // private) or it was deleted. Emit a titleless tombstone so the UI can
      // render a no-access placeholder instead of leaking the title.
      const inaccessible = row.document_ref_id === null;
      docIds.add(docId);
      nodeMap[docId] = {
        charCount: inaccessible ? null : row.document_char_count,
        createdAt: row.created_at,
        fileType: inaccessible ? '' : row.document_file_type,
        inaccessible: inaccessible || undefined,
        parentId: inaccessible ? null : row.document_parent_id,
        pinnedBy: row.pinned_by,
        sourceTaskId: row.source_task_id,
        sourceTaskIdentifier: row.source_task_id !== rootTaskId ? row.source_task_identifier : null,
        title: inaccessible ? '' : row.document_title || 'Untitled',
        updatedAt: inaccessible ? null : row.document_updated_at,
      };
    }

    // Build tree (children as id references)
    type TreeNode = WorkspaceTreeNode;

    const childrenMap = new Map<string | null, TreeNode[]>();
    for (const docId of docIds) {
      const node = nodeMap[docId];
      const parentId = node.parentId && docIds.has(node.parentId) ? node.parentId : null;
      const list = childrenMap.get(parentId) || [];
      list.push({ children: [], id: docId });
      childrenMap.set(parentId, list);
    }

    const buildTree = (parentId: string | null): TreeNode[] => {
      const nodes = childrenMap.get(parentId) || [];
      for (const node of nodes) {
        node.children = buildTree(node.id);
      }
      return nodes;
    };

    return { nodeMap, tree: buildTree(null) };
  }

  // ========== Topic Management ==========

  async incrementTopicCount(id: string): Promise<void> {
    await this.db
      .update(tasks)
      .set({
        totalTopics: sql`${tasks.totalTopics} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, id), this.ownership()));
  }

  async updateCurrentTopic(id: string, topicId: string): Promise<void> {
    await this.db
      .update(tasks)
      .set({ currentTopicId: topicId, updatedAt: new Date() })
      .where(and(eq(tasks.id, id), this.ownership()));
  }

  // ========== Comments ==========

  private commentsOwnership = () =>
    this.childOwnership({
      userId: taskComments.userId,
      visibility: taskComments.visibility,
      workspaceId: taskComments.workspaceId,
    });

  async addComment(data: Omit<NewTaskComment, 'id'>): Promise<TaskCommentItem> {
    // Mirror the parent task's visibility onto the comment so subsequent
    // reads/writes can be filtered without a JOIN. Falls back to 'public'
    // if the task is somehow not visible (defensive — the caller should
    // already have validated the task via `resolveOrThrow`).
    const visibility = await this.getTaskVisibility(data.taskId);
    const [comment] = await this.db
      .insert(taskComments)
      .values({ ...data, visibility, workspaceId: this.workspaceId ?? null })
      .returning();
    return comment;
  }

  async findCommentById(id: string): Promise<TaskCommentItem | undefined> {
    const [comment] = await this.db
      .select()
      .from(taskComments)
      .where(and(eq(taskComments.id, id), this.commentsOwnership()))
      .limit(1);
    return comment;
  }

  async getComments(taskId: string): Promise<TaskCommentItem[]> {
    return this.db
      .select()
      .from(taskComments)
      .where(and(eq(taskComments.taskId, taskId), this.commentsOwnership()))
      .orderBy(taskComments.createdAt);
  }

  async deleteComment(id: string): Promise<boolean> {
    const result = await this.db
      .delete(taskComments)
      .where(and(eq(taskComments.id, id), this.commentsOwnership()))
      .returning();
    return result.length > 0;
  }

  async updateComment(
    id: string,
    content: string,
    opts?: { editorData?: unknown },
  ): Promise<TaskCommentItem | undefined> {
    const [comment] = await this.db
      .update(taskComments)
      .set({
        content,
        ...(opts?.editorData !== undefined ? { editorData: opts.editorData as never } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(taskComments.id, id), this.commentsOwnership()))
      .returning();
    return comment;
  }

  // ========== Transfer / Copy ==========

  /**
   * Collect a task and all its descendants (parentTaskId-linked) via BFS.
   * Honors the current ownership scope.
   */
  private async collectTaskSubtree(rootId: string, runner: LobeChatDatabase): Promise<TaskItem[]> {
    const [root] = await runner
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, rootId), this.ownership()))
      .limit(1);
    if (!root) return [];

    const collected: TaskItem[] = [root];
    let frontier: string[] = [root.id];

    while (frontier.length > 0) {
      const children = await runner
        .select()
        .from(tasks)
        .where(and(inArray(tasks.parentTaskId, frontier), this.ownership()));
      if (children.length === 0) break;
      collected.push(...children);
      frontier = children.map((c) => c.id);
    }

    return collected;
  }

  /**
   * Allocate a contiguous block of seq numbers + identifiers in the target
   * scope. Returns the next available seq baseline.
   */
  private async nextSeqIn(
    runner: LobeChatDatabase,
    targetWorkspaceId: string | null,
    targetUserId: string,
  ): Promise<number> {
    const where = targetWorkspaceId
      ? eq(tasks.workspaceId, targetWorkspaceId)
      : and(eq(tasks.createdByUserId, targetUserId), isNull(tasks.workspaceId));
    const [{ maxSeq }] = await runner
      .select({ maxSeq: sql<number>`COALESCE(MAX(${tasks.seq}), 0)` })
      .from(tasks)
      .where(where!);
    return Number(maxSeq) + 1;
  }

  /**
   * Transfer a task subtree to another workspace / personal scope. Reallocates
   * `identifier`/`seq` in the target scope and rewrites every dependent child
   * table (`task_dependencies`, `task_documents`, `task_topics`,
   * `task_comments`, `briefs`) so the ownership predicates remain consistent.
   *
   * Cross-scope references that may no longer be valid are cleared:
   *   - `assigneeAgentId` (workspace move: agent likely doesn't exist there)
   *   - `currentTopicId` (topic ownership is also moving but the link is
   *     reset to avoid surfacing a stale active topic in the new scope)
   */
  /**
   * Whether the task subtree contains rows created by someone else. Transfers
   * rehome every cascaded row, so non-owner members must not move a task tree
   * that carries teammates' subtasks.
   */
  async subtreeHasForeignRows(taskId: string): Promise<boolean> {
    const subtree = await this.collectTaskSubtree(taskId, this.db);
    return subtree.some((task) => task.createdByUserId !== this.userId);
  }

  async transferTo(
    taskId: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
    targetVisibility?: 'private' | 'public',
  ): Promise<{ taskIds: string[] }> {
    return this.db.transaction(async (trx) => {
      const scoped = new TaskModel(trx as LobeChatDatabase, this.userId, this.workspaceId);
      const subtree = await scoped.collectTaskSubtree(taskId, trx as LobeChatDatabase);
      if (subtree.length === 0) throw new Error('Task not found');

      const ids = subtree.map((t) => t.id);

      // Visibility only applies when landing in a workspace. In personal scope
      // every row is implicitly private and the field is ignored.
      const visibilityUpdate =
        targetWorkspaceId && targetVisibility ? { visibility: targetVisibility } : {};

      // Reallocate identifier + seq in target scope to avoid collisions.
      const baseSeq = await this.nextSeqIn(
        trx as LobeChatDatabase,
        targetWorkspaceId,
        targetUserId,
      );
      // Update each task individually because identifier/seq are per-row.
      for (const [idx, task] of subtree.entries()) {
        const seq = baseSeq + idx;
        const identifier = `T-${seq}`;
        await (trx as LobeChatDatabase)
          .update(tasks)
          .set({
            // Clear cross-scope refs: agent / topic may be invalid in new scope.
            assigneeAgentId: targetWorkspaceId === this.workspaceId ? task.assigneeAgentId : null,
            createdByUserId: targetUserId,
            currentTopicId: null,
            identifier,
            seq,
            updatedAt: new Date(),
            workspaceId: targetWorkspaceId,
            ...visibilityUpdate,
          })
          .where(eq(tasks.id, task.id));
      }

      // Update child tables that key off taskId. Child rows mirror the parent
      // task's visibility (see schema comments on task_deps / task_docs /
      // task_comments) so cascade the new visibility here too.
      const ownershipUpdate = { userId: targetUserId, workspaceId: targetWorkspaceId };
      await (trx as LobeChatDatabase)
        .update(taskDependencies)
        .set({ ...ownershipUpdate, ...visibilityUpdate })
        .where(inArray(taskDependencies.taskId, ids));
      await (trx as LobeChatDatabase)
        .update(taskDocuments)
        .set({ ...ownershipUpdate, ...visibilityUpdate })
        .where(inArray(taskDocuments.taskId, ids));
      await (trx as LobeChatDatabase)
        .update(taskComments)
        .set({ ...ownershipUpdate, ...visibilityUpdate })
        .where(inArray(taskComments.taskId, ids));

      return { taskIds: ids };
    });
  }

  /**
   * Deep clone a task subtree into another workspace / personal scope. Fresh
   * ids, fresh identifiers, preserved parent/child topology. Cross-scope refs
   * (agent / topic / brief / current topic) are cleared on the clones so the
   * copies start clean in the new scope.
   */
  async copyToWorkspace(
    taskId: string,
    targetWorkspaceId: string | null,
    targetUserId: string,
    targetVisibility?: 'private' | 'public',
  ): Promise<{ rootId: string }> {
    return this.db.transaction(async (trx) => {
      const scoped = new TaskModel(trx as LobeChatDatabase, this.userId, this.workspaceId);
      const subtree = await scoped.collectTaskSubtree(taskId, trx as LobeChatDatabase);
      if (subtree.length === 0) throw new Error('Task not found');

      // Visibility only applies when landing in a workspace.
      const visibilityOverride =
        targetWorkspaceId && targetVisibility ? { visibility: targetVisibility } : {};

      // BFS clone — parent inserted before children, so we always know the
      // new parentTaskId by the time we reach the child.
      const idMap = new Map<string, string>();
      const byId = new Map(subtree.map((t) => [t.id, t]));
      const queue: string[] = [taskId];
      const seen = new Set<string>();

      let seq = await this.nextSeqIn(trx as LobeChatDatabase, targetWorkspaceId, targetUserId);

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (seen.has(currentId)) continue;
        seen.add(currentId);
        const original = byId.get(currentId);
        if (!original) continue;

        const newParentId =
          currentId === taskId ? null : (idMap.get(original.parentTaskId!) ?? null);

        const identifier = `T-${seq}`;
        const inserted = (await (trx as LobeChatDatabase)
          .insert(tasks)
          .values({
            assigneeAgentId: null,
            assigneeUserId: null,
            automationMode: original.automationMode,
            config: original.config ?? {},
            context: {
              ...(original.context as Record<string, unknown>),
              duplicatedFrom: original.id,
            },
            createdByAgentId: null,
            createdByUserId: targetUserId,
            currentTopicId: null,
            description: original.description,
            error: null,
            heartbeatInterval: original.heartbeatInterval,
            heartbeatTimeout: original.heartbeatTimeout,
            identifier,
            instruction: original.instruction,
            maxTopics: original.maxTopics,
            name: original.name,
            parentTaskId: newParentId,
            priority: original.priority,
            schedulePattern: original.schedulePattern,
            scheduleTimezone: original.scheduleTimezone,
            seq,
            sortOrder: original.sortOrder,
            // Reset lifecycle: copy starts fresh, not mid-run.
            status: 'backlog',
            totalTopics: 0,
            workspaceId: targetWorkspaceId,
            ...visibilityOverride,
          } as NewTask)
          .returning({ id: tasks.id })) as { id: string }[];

        idMap.set(original.id, inserted[0]!.id);
        seq++;

        for (const c of subtree) {
          if (c.parentTaskId === original.id) queue.push(c.id);
        }
      }

      return { rootId: idMap.get(taskId)! };
    });
  }
}
