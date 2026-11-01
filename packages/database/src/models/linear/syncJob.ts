import type { LinearSyncJobMetadata } from '@lobechat/types';
import { AsyncTaskStatus, AsyncTaskType } from '@lobechat/types';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { asyncTasks } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';
import type { LinearConnectionScope } from './connection';

export type LinearSyncJobRow = typeof asyncTasks.$inferSelect & {
  metadata: LinearSyncJobMetadata;
};

const ACTIVE_STATUSES = [AsyncTaskStatus.Pending, AsyncTaskStatus.Processing];

/**
 * Background Linear issue syncs. They live in `async_tasks` (type
 * `linear_issue_sync`) with what to sync in `metadata`; these reads narrow
 * them to a scope and a LobeHub project.
 */
export class LinearSyncJobModel {
  static listByProject = async (
    db: LobeChatDatabase,
    scope: LinearConnectionScope,
    projectId: string,
    limit = 10,
  ): Promise<LinearSyncJobRow[]> =>
    (await db
      .select()
      .from(asyncTasks)
      .where(projectCondition(scope, projectId))
      .orderBy(desc(asyncTasks.createdAt))
      .limit(limit)) as LinearSyncJobRow[];

  /**
   * Move a queued job to processing. Only one caller wins, so a retried
   * request never runs the same sync twice.
   */
  static claim = async (
    db: LobeChatDatabase,
    scope: LinearConnectionScope,
    taskId: string,
  ): Promise<LinearSyncJobRow | null> => {
    const [row] = await db
      .update(asyncTasks)
      .set({ status: AsyncTaskStatus.Processing, updatedAt: new Date() })
      .where(
        and(
          eq(asyncTasks.id, taskId),
          eq(asyncTasks.type, AsyncTaskType.LinearIssueSync),
          eq(asyncTasks.status, AsyncTaskStatus.Pending),
          buildWorkspaceWhere(
            { userId: scope.userId, workspaceId: scope.workspaceId ?? undefined },
            asyncTasks,
          ),
        ),
      )
      .returning();
    return (row as LinearSyncJobRow | undefined) ?? null;
  };

  /**
   * Record that a running job is still alive, so a long sync is not mistaken
   * for one that was cut off. A job that already finished is left as is.
   */
  static touch = async (
    db: LobeChatDatabase,
    scope: LinearConnectionScope,
    taskId: string,
  ): Promise<void> => {
    await db
      .update(asyncTasks)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(asyncTasks.id, taskId),
          eq(asyncTasks.type, AsyncTaskType.LinearIssueSync),
          eq(asyncTasks.status, AsyncTaskStatus.Processing),
          buildWorkspaceWhere(
            { userId: scope.userId, workspaceId: scope.workspaceId ?? undefined },
            asyncTasks,
          ),
        ),
      );
  };

  /**
   * Update a job only while it is still in one of `from` and no stop was
   * requested, so a write from a run stopped meanwhile cannot carry it on.
   * Returns whether the job was updated.
   */
  static transition = async (
    db: LobeChatDatabase,
    scope: LinearConnectionScope,
    taskId: string,
    from: AsyncTaskStatus[],
    set: Partial<
      Pick<typeof asyncTasks.$inferInsert, 'duration' | 'error' | 'metadata' | 'status'>
    >,
  ): Promise<boolean> => {
    const rows = await db
      .update(asyncTasks)
      .set({ ...set, updatedAt: new Date() })
      .where(
        and(
          jobCondition(scope, taskId),
          inArray(asyncTasks.status, from),
          isNull(asyncTasks.error),
        ),
      )
      .returning({ id: asyncTasks.id });
    return rows.length > 0;
  };

  /**
   * End a running job whose stop was requested, once its round has written
   * what it was writing. Keeps the outcome so far.
   */
  static settleStopped = async (
    db: LobeChatDatabase,
    scope: LinearConnectionScope,
    taskId: string,
    set: Partial<Pick<typeof asyncTasks.$inferInsert, 'duration' | 'metadata'>>,
  ): Promise<void> => {
    await db
      .update(asyncTasks)
      .set({ ...set, status: AsyncTaskStatus.Error, updatedAt: new Date() })
      .where(
        and(
          jobCondition(scope, taskId),
          eq(asyncTasks.status, AsyncTaskStatus.Processing),
          sql`${asyncTasks.error} ->> 'code' = 'canceled'`,
        ),
      );
  };

  /**
   * Stop a rule run of this project that has not finished. One still queued ends
   * at once. One running is marked as stopping and stays active, so the rule
   * cannot start again while its round still writes; that round finishes the
   * tasks it is writing, then the job ends without starting another. Returns
   * whether a job was stopped.
   */
  static cancel = async (
    db: LobeChatDatabase,
    scope: LinearConnectionScope,
    projectId: string,
    taskId: string,
  ): Promise<boolean> => {
    // One statement over both active states, so a round moving the job from
    // processing to pending at the same moment cannot slip past the stop.
    const rows = await db
      .update(asyncTasks)
      .set({
        error: { code: 'canceled' },
        status: sql`CASE WHEN ${asyncTasks.status} = ${AsyncTaskStatus.Pending} THEN ${AsyncTaskStatus.Error} ELSE ${asyncTasks.status} END`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(asyncTasks.id, taskId),
          projectCondition(scope, projectId),
          inArray(asyncTasks.status, ACTIVE_STATUSES),
          isNull(asyncTasks.error),
          // An import of picked issues is a single round; it cannot be cut short.
          sql`${asyncTasks.metadata} ->> 'kind' = 'rule'`,
        ),
      )
      .returning({ id: asyncTasks.id });
    return rows.length > 0;
  };

  /** A run of this rule that has not finished yet, if any. */
  static findActiveForRule = async (
    db: LobeChatDatabase,
    scope: LinearConnectionScope,
    projectId: string,
    ruleId: string,
  ): Promise<LinearSyncJobRow | null> => {
    const [row] = await db
      .select()
      .from(asyncTasks)
      .where(
        and(
          projectCondition(scope, projectId),
          inArray(asyncTasks.status, ACTIVE_STATUSES),
          sql`${asyncTasks.metadata} ->> 'ruleId' = ${ruleId}`,
        ),
      )
      .orderBy(desc(asyncTasks.createdAt))
      .limit(1);
    return (row as LinearSyncJobRow | undefined) ?? null;
  };
}

const jobCondition = (scope: LinearConnectionScope, taskId: string) =>
  and(
    eq(asyncTasks.id, taskId),
    eq(asyncTasks.type, AsyncTaskType.LinearIssueSync),
    buildWorkspaceWhere(
      { userId: scope.userId, workspaceId: scope.workspaceId ?? undefined },
      asyncTasks,
    ),
  );

const projectCondition = (scope: LinearConnectionScope, projectId: string) =>
  and(
    eq(asyncTasks.type, AsyncTaskType.LinearIssueSync),
    sql`${asyncTasks.metadata} ->> 'projectId' = ${projectId}`,
    buildWorkspaceWhere(
      { userId: scope.userId, workspaceId: scope.workspaceId ?? undefined },
      asyncTasks,
    ),
  );
