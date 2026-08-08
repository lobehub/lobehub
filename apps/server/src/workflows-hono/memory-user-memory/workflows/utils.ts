import { AsyncTaskStatus } from '@lobechat/types';
import { eq } from 'drizzle-orm';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { asyncTasks } from '@/database/schemas';
import { getServerDB } from '@/database/server';

/**
 * Cursor shape accepted by workflow pagination serializers.
 */
export interface WorkflowCursorLike {
  /**
   * Cursor timestamp from a live database row or a JSON-restored workflow step result.
   */
  createdAt: Date | string;
  /**
   * Stable cursor id used to break ties when timestamps are equal.
   */
  id: string;
}

/**
 * Serializes a workflow cursor into the JSON-safe cursor shape.
 *
 * Use when:
 * - Scheduling a child workflow with a pagination cursor
 * - Passing cursor data across Upstash Workflow JSON boundaries
 *
 * Expects:
 * - `createdAt` is either a valid Date or an ISO-compatible date string
 *
 * Returns:
 * - A cursor with `createdAt` normalized to an ISO string
 *
 * Before:
 * - { createdAt: Date("2024-07-02T09:36:44.073Z"), id: "user_1" }
 * - { createdAt: "2024-07-02T09:36:44.073Z", id: "user_1" }
 *
 * After:
 * - { createdAt: "2024-07-02T09:36:44.073Z", id: "user_1" }
 */
export const serializeWorkflowCursor = (
  cursor: WorkflowCursorLike,
  errorMessage = 'Invalid workflow cursor date',
) => {
  // NOTICE:
  // Upstash Workflow persists step results as JSON and restores Date values as strings.
  // This cursor can come from a live DB result or a restored context.run result.
  // Keep accepting both shapes until workflow step serialization preserves Date objects.
  const createdAt = new Date(cursor.createdAt);
  if (Number.isNaN(createdAt.getTime())) {
    throw new Error(errorMessage);
  }

  return { createdAt: createdAt.toISOString(), id: cursor.id };
};

/**
 * Checks whether an hourly user-memory extraction task has requested cancellation.
 *
 * Use when:
 * - A workflow stage is about to schedule child workflow fan-out
 * - A workflow stage is about to run heavyweight extraction work for hourly processing
 *
 * Expects:
 * - `hourlyTaskId` is the batch-level async task id from the workflow payload
 * - The async task row owns the user/workspace needed by AsyncTaskModel ownership checks
 *
 * Returns:
 * - `true` when the hourly task exists and has requested cancellation
 * - `false` when no hourly task id is present, the task is missing, or cancellation is absent
 */
export const isHourlyMemoryExtractionCancelled = async (hourlyTaskId?: string) => {
  if (!hourlyTaskId) return false;

  const db = await getServerDB();
  const task = await db.query.asyncTasks.findFirst({
    where: eq(asyncTasks.id, hourlyTaskId),
  });
  if (!task) return false;

  return new AsyncTaskModel(
    db,
    task.userId,
    task.workspaceId ?? undefined,
  ).isHourlyMemoryExtractionCancellationRequested(hourlyTaskId);
};

/**
 * Appends a child workflow run id to an hourly user-memory extraction task.
 *
 * Use when:
 * - A workflow fan-out trigger returns a child `workflowRunId`
 * - The hourly async task should retain known Upstash workflow run ids for cancellation
 *
 * Expects:
 * - `hourlyTaskId` is optional because the same workflow handlers support non-hourly entrypoints
 * - `workflowRunId` may be absent when a trigger implementation returns no child id
 *
 * Returns:
 * - Nothing; append failures are logged and never fail the workflow stage
 */
export const appendHourlyWorkflowRunId = async (
  hourlyTaskId: string | undefined,
  workflowRunId?: string,
) => {
  if (!hourlyTaskId || !workflowRunId) return;

  try {
    const db = await getServerDB();
    const task = await db.query.asyncTasks.findFirst({
      where: eq(asyncTasks.id, hourlyTaskId),
    });
    if (!task) return;

    await new AsyncTaskModel(
      db,
      task.userId,
      task.workspaceId ?? undefined,
    ).appendUserMemoryWorkflowRunIds(hourlyTaskId, [workflowRunId]);
  } catch (error) {
    console.error('[memory-user-memory] failed to append hourly workflow run id', error);
  }
};

export const markHourlyMemoryExtractionSuccess = async (
  hourlyTaskId: string | undefined,
  progress: {
    processedUsers: number;
    scheduledBatches: number;
    scheduledChildRuns: number;
  },
) => {
  if (!hourlyTaskId) return;

  const db = await getServerDB();
  const task = await db.query.asyncTasks.findFirst({
    where: eq(asyncTasks.id, hourlyTaskId),
  });
  if (!task) return;

  await new AsyncTaskModel(
    db,
    task.userId,
    task.workspaceId ?? undefined,
  ).markHourlyMemoryExtractionSuccess(hourlyTaskId, {
    ...progress,
    status: AsyncTaskStatus.Success,
  });
};
