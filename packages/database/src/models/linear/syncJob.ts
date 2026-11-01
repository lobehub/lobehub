import type { LinearSyncJobMetadata } from '@lobechat/types';
import { AsyncTaskStatus, AsyncTaskType } from '@lobechat/types';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

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
   * Update a job only while it is still in one of `from`, so a write from a
   * run that was stopped meanwhile cannot bring it back. Returns whether the
   * job was updated.
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
          eq(asyncTasks.id, taskId),
          eq(asyncTasks.type, AsyncTaskType.LinearIssueSync),
          inArray(asyncTasks.status, from),
          buildWorkspaceWhere(
            { userId: scope.userId, workspaceId: scope.workspaceId ?? undefined },
            asyncTasks,
          ),
        ),
      )
      .returning({ id: asyncTasks.id });
    return rows.length > 0;
  };

  /**
   * Stop a job of this project that has not finished. A round already running
   * completes the tasks it is writing, but no further round starts. Returns
   * whether a job was stopped.
   */
  static cancel = async (
    db: LobeChatDatabase,
    scope: LinearConnectionScope,
    projectId: string,
    taskId: string,
  ): Promise<boolean> => {
    const rows = await db
      .update(asyncTasks)
      .set({ error: { code: 'canceled' }, status: AsyncTaskStatus.Error, updatedAt: new Date() })
      .where(
        and(
          eq(asyncTasks.id, taskId),
          projectCondition(scope, projectId),
          inArray(asyncTasks.status, ACTIVE_STATUSES),
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

const projectCondition = (scope: LinearConnectionScope, projectId: string) =>
  and(
    eq(asyncTasks.type, AsyncTaskType.LinearIssueSync),
    sql`${asyncTasks.metadata} ->> 'projectId' = ${projectId}`,
    buildWorkspaceWhere(
      { userId: scope.userId, workspaceId: scope.workspaceId ?? undefined },
      asyncTasks,
    ),
  );
