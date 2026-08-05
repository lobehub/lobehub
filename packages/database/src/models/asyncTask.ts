import { ASYNC_TASK_TIMEOUT } from '@lobechat/business-config/server';
import type {
  HourlyUserMemoryExtractionMetadata,
  HourlyUserMemoryExtractionProgress,
  UserMemoryExtractionMetadata,
} from '@lobechat/types';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
} from '@lobechat/types';
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';

import type { AsyncTaskSelectItem, NewAsyncTaskItem } from '../schemas';
import { asyncTasks } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export class AsyncTaskModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private ownership = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, asyncTasks);

  create = async (
    params: Pick<NewAsyncTaskItem, 'type' | 'status' | 'metadata' | 'parentId'>,
  ): Promise<string> => {
    const data = await this.db
      .insert(asyncTasks)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          { ...params },
        ),
      )
      .returning();

    return data[0].id;
  };

  delete = async (id: string) => {
    return this.db.delete(asyncTasks).where(and(eq(asyncTasks.id, id), this.ownership()));
  };

  findById = async (id: string) => {
    return this.db.query.asyncTasks.findFirst({
      where: and(eq(asyncTasks.id, id), this.ownership()),
    });
  };

  static findByInferenceId = async (db: LobeChatDatabase, inferenceId: string) => {
    return db.query.asyncTasks.findFirst({
      where: eq(asyncTasks.inferenceId, inferenceId),
    });
  };

  update(taskId: string, value: Partial<AsyncTaskSelectItem>) {
    return this.db
      .update(asyncTasks)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(asyncTasks.id, taskId), this.ownership()));
  }

  findActiveByType = async (type: AsyncTaskType) => {
    return this.db.query.asyncTasks.findFirst({
      where: and(
        this.ownership(),
        eq(asyncTasks.type, type),
        inArray(asyncTasks.status, [AsyncTaskStatus.Pending, AsyncTaskStatus.Processing]),
      ),
    });
  };

  incrementUserMemoryExtractionProgress = async (taskId: string) => {
    const completedExpr = sql<number>`COALESCE(((${asyncTasks.metadata}) -> 'progress' ->> 'completedTopics')::int, 0) + 1`;
    const totalExpr = sql<
      number | null
    >`((${asyncTasks.metadata}) -> 'progress' ->> 'totalTopics')::int`;

    const result = await this.db
      .update(asyncTasks)
      .set({
        metadata: sql`
          jsonb_set(
            jsonb_set(
              ${asyncTasks.metadata},
              '{progress,completedTopics}',
              to_jsonb(${completedExpr}),
              true
            ),
            '{progress,totalTopics}',
            COALESCE((${asyncTasks.metadata}) -> 'progress' -> 'totalTopics', 'null'::jsonb),
            true
          )
        `,
        status: sql`
          CASE
            WHEN ${asyncTasks.status} = ${AsyncTaskStatus.Error} OR ${asyncTasks.error} IS NOT NULL
              THEN ${AsyncTaskStatus.Error}
            WHEN ${totalExpr} IS NOT NULL AND ${completedExpr} >= ${totalExpr}
              THEN ${AsyncTaskStatus.Success}
            ELSE ${AsyncTaskStatus.Processing}
          END
        `,
        updatedAt: new Date(),
      })
      .where(and(eq(asyncTasks.id, taskId), this.ownership()))
      .returning({ metadata: asyncTasks.metadata, status: asyncTasks.status });

    return result[0];
  };

  findByIds = async (taskIds: string[], type: AsyncTaskType): Promise<AsyncTaskSelectItem[]> => {
    let chunkTasks: AsyncTaskSelectItem[] = [];

    if (taskIds.length > 0) {
      await this.checkTimeoutTasks(taskIds);
      chunkTasks = await this.db.query.asyncTasks.findMany({
        where: and(inArray(asyncTasks.id, taskIds), eq(asyncTasks.type, type), this.ownership()),
      });
    }

    return chunkTasks;
  };

  isUserMemoryExtractionCancellationRequested = async (taskId: string) => {
    // NOTICE: Shared cancellation gate for cooperative cascading cancellation.
    // Workflow stages call this before fan-out/heavy steps to stop the remaining task tree.
    const task = await this.findById(taskId);
    if (!task || task.userId !== this.userId) return false;
    if (task.type !== AsyncTaskType.UserMemoryExtractionWithChatTopic) return false;

    const metadata = task.metadata as UserMemoryExtractionMetadata | undefined;
    return Boolean(metadata?.control?.cancelRequestedAt);
  };

  appendUserMemoryWorkflowRunIds = async (taskId: string, workflowRunIds: string[]) => {
    const uniqueIds = Array.from(new Set(workflowRunIds.filter(Boolean)));
    if (uniqueIds.length === 0) return;

    const incomingIdsJson = JSON.stringify(uniqueIds);
    const mergedIdsExpr = sql`
      (
        SELECT COALESCE(jsonb_agg(value ORDER BY first_ordinal), '[]'::jsonb)
        FROM (
          SELECT value, MIN(ordinality) AS first_ordinal
          FROM jsonb_array_elements_text(
            COALESCE(
              ${asyncTasks.metadata} #> '{control,upstash,workflowRunIds}',
              '[]'::jsonb
            ) || ${incomingIdsJson}::jsonb
          ) WITH ORDINALITY AS ids(value, ordinality)
          GROUP BY value
        ) AS deduped_ids
      )
    `;

    await this.db
      .update(asyncTasks)
      .set({
        metadata: sql`
          jsonb_set(
            jsonb_set(
              jsonb_set(
                ${asyncTasks.metadata},
                '{control}',
                COALESCE(${asyncTasks.metadata} -> 'control', '{}'::jsonb),
                true
              ),
              '{control,upstash}',
              COALESCE(${asyncTasks.metadata} #> '{control,upstash}', '{}'::jsonb),
              true
            ),
            '{control,upstash,workflowRunIds}',
            ${mergedIdsExpr},
            true
          )
        `,
        updatedAt: new Date(),
      })
      .where(and(eq(asyncTasks.id, taskId), this.ownership()));
  };

  markHourlyMemoryExtractionSuccess = async (
    taskId: string,
    progress: HourlyUserMemoryExtractionProgress & { status: AsyncTaskStatus.Success },
  ) => {
    await this.db
      .update(asyncTasks)
      .set({
        metadata: sql`
          jsonb_set(
            jsonb_set(
              jsonb_set(
                ${asyncTasks.metadata},
                '{progress,processedUsers}',
                to_jsonb(${progress.processedUsers}::int),
                true
              ),
              '{progress,scheduledBatches}',
              to_jsonb(${progress.scheduledBatches}::int),
              true
            ),
            '{progress,scheduledChildRuns}',
            to_jsonb(${progress.scheduledChildRuns}::int),
            true
          )
        `,
        status: sql`
          CASE
            WHEN ${asyncTasks.status} = ${AsyncTaskStatus.Error} OR ${asyncTasks.error} IS NOT NULL
              THEN ${AsyncTaskStatus.Error}
            ELSE ${progress.status}
          END
        `,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(asyncTasks.id, taskId),
          eq(asyncTasks.type, AsyncTaskType.UserMemoryExtractionHourly),
          this.ownership(),
        ),
      );
  };

  isHourlyMemoryExtractionCancellationRequested = async (taskId: string) => {
    const task = await this.findById(taskId);
    if (!task || task.userId !== this.userId) return false;
    if (task.type !== AsyncTaskType.UserMemoryExtractionHourly) return false;

    const metadata = task.metadata as HourlyUserMemoryExtractionMetadata | undefined;
    return Boolean(metadata?.control?.cancelRequestedAt);
  };

  /**
   * make the task status to be `error` if the task is not finished in 20 seconds
   */
  checkTimeoutTasks = async (ids: string[]) => {
    const tasks = await this.db
      .select({ id: asyncTasks.id })
      .from(asyncTasks)
      .where(
        and(
          inArray(asyncTasks.id, ids),
          this.ownership(),
          or(
            eq(asyncTasks.status, AsyncTaskStatus.Pending),
            eq(asyncTasks.status, AsyncTaskStatus.Processing),
          ),
          lt(asyncTasks.createdAt, new Date(Date.now() - ASYNC_TASK_TIMEOUT)),
        ),
      );

    if (tasks.length > 0) {
      await this.db
        .update(asyncTasks)
        .set({
          error: new AsyncTaskError(
            AsyncTaskErrorType.Timeout,
            'task is timeout, please try again',
          ),
          status: AsyncTaskStatus.Error,
        })
        .where(
          and(
            inArray(
              asyncTasks.id,
              tasks.map((item) => item.id),
            ),
            this.ownership(),
          ),
        );
    }
  };
}

export const initUserMemoryExtractionMetadata = (
  metadata?: UserMemoryExtractionMetadata,
): UserMemoryExtractionMetadata => ({
  control: metadata?.control
    ? {
        cancelReason: metadata.control.cancelReason,
        cancelRequestedAt: metadata.control.cancelRequestedAt,
        cancelledBy: metadata.control.cancelledBy,
        upstash: metadata.control.upstash
          ? {
              entryWorkflowRunId: metadata.control.upstash.entryWorkflowRunId,
              workflowRunIds: metadata.control.upstash.workflowRunIds || [],
            }
          : undefined,
      }
    : undefined,
  progress: {
    completedTopics: metadata?.progress?.completedTopics ?? 0,
    totalTopics: metadata?.progress?.totalTopics ?? null,
  },
  range: metadata?.range,
  source: metadata?.source ?? 'chat_topic',
});

/**
 * Initializes hourly user memory extraction metadata.
 *
 * Use when:
 * - Creating the batch-level hourly extraction async task
 * - Normalizing persisted hourly extraction metadata before updates
 *
 * Expects:
 * - `startedAt` is the ISO timestamp for the hourly scheduler run
 *
 * Returns:
 * - Hourly metadata with progress counters defaulted to zero
 */
export const initHourlyUserMemoryExtractionMetadata = (
  metadata: Partial<HourlyUserMemoryExtractionMetadata> & { startedAt: string },
): HourlyUserMemoryExtractionMetadata => ({
  control: metadata.control
    ? {
        cancelReason: metadata.control.cancelReason,
        cancelRequestedAt: metadata.control.cancelRequestedAt,
        cancelledBy: metadata.control.cancelledBy,
        upstash: metadata.control.upstash
          ? {
              entryWorkflowRunId: metadata.control.upstash.entryWorkflowRunId,
              workflowRunIds: metadata.control.upstash.workflowRunIds || [],
            }
          : undefined,
      }
    : undefined,
  cursor: metadata.cursor,
  progress: {
    processedUsers: metadata.progress?.processedUsers ?? 0,
    scheduledBatches: metadata.progress?.scheduledBatches ?? 0,
    scheduledChildRuns: metadata.progress?.scheduledChildRuns ?? 0,
  },
  source: 'hourly_chat_topic',
  startedAt: metadata.startedAt,
});
