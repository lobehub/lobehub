import { and, eq, sql } from 'drizzle-orm';

import {
  AsyncTaskModel,
  initHourlyUserMemoryExtractionMetadata,
} from '@/database/models/asyncTask';
import { asyncTasks } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { getMemoryWorkflowTrigger } from '@/server/services/memory/userMemory/workflow/impls';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
} from '@/types/asyncTask';

import type {
  MemoryExtractionHourlyWorkflowPayload,
  MemoryExtractionPayloadInput,
  UserTopicWorkflowPayload,
} from './payload';

const buildHourlyChildWorkflowRunId = (entryWorkflowRunId: string) =>
  `memory-user-memory-hourly-${entryWorkflowRunId.replaceAll(/[^\w-]/g, '_')}`;

/**
 * Facade for memory extraction workflow triggers.
 *
 * Delegates to the transport-specific implementation selected by
 * MEMORY_WORKFLOW_MODE / AGENT_RUNTIME_MODE environment variables
 * (QStash, BullMQ, or in-process local execution).
 *
 * `triggerHourlyTracked` retains its DB logic here (async task creation,
 * idempotency checks) and delegates only the actual trigger call.
 */
export class MemoryExtractionWorkflowService {
  static triggerProcessUsers(
    payload: MemoryExtractionPayloadInput,
    options?: { extraHeaders?: Record<string, string> },
  ) {
    return getMemoryWorkflowTrigger().triggerProcessUsers(payload, options);
  }

  static triggerHourly(
    payload: MemoryExtractionHourlyWorkflowPayload,
    options?: { extraHeaders?: Record<string, string>; workflowRunId?: string },
  ) {
    return getMemoryWorkflowTrigger().triggerHourly(payload, options);
  }

  /**
   * Creates a batch-level async task and triggers hourly memory extraction.
   *
   * Use when:
   * - Starting the hourly user-memory extraction workflow from cron or an operator action
   * - Tracking the root workflow run id for later cooperative cancellation
   *
   * Expects:
   * - `payload.baseUrl` is present for workflow URL construction
   * - `MEMORY_EXTRACTION_HOURLY_TASK_USER_ID` identifies the service-account task owner
   *
   * Returns:
   * - The created async task id and root workflow run id
   */
  static async triggerHourlyTracked(
    payload: MemoryExtractionHourlyWorkflowPayload,
    options?: { entryWorkflowRunId?: string; extraHeaders?: Record<string, string> },
  ) {
    if (!payload.baseUrl) {
      throw new Error('Missing baseUrl for workflow trigger');
    }

    const userId = process.env.MEMORY_EXTRACTION_HOURLY_TASK_USER_ID;
    if (!userId) {
      throw new Error(
        'MEMORY_EXTRACTION_HOURLY_TASK_USER_ID is required for tracked hourly extraction',
      );
    }

    const db = await getServerDB();
    const startedAt = new Date().toISOString();
    const childWorkflowRunId = options?.entryWorkflowRunId
      ? buildHourlyChildWorkflowRunId(options.entryWorkflowRunId)
      : undefined;
    const existingTask = options?.entryWorkflowRunId
      ? await db.query.asyncTasks.findFirst({
          where: and(
            eq(asyncTasks.type, AsyncTaskType.UserMemoryExtractionHourly),
            eq(asyncTasks.userId, userId),
            sql`${asyncTasks.metadata} #>> '{control,upstash,entryWorkflowRunId}' = ${options.entryWorkflowRunId}`,
          ),
        })
      : undefined;
    const asyncTaskModel = new AsyncTaskModel(db, userId);
    const taskId =
      existingTask?.id ??
      (await asyncTaskModel.create({
        metadata: initHourlyUserMemoryExtractionMetadata({
          control: options?.entryWorkflowRunId
            ? {
                upstash: {
                  entryWorkflowRunId: options.entryWorkflowRunId,
                  workflowRunIds: [
                    options.entryWorkflowRunId,
                    ...(childWorkflowRunId ? [childWorkflowRunId] : []),
                  ],
                },
              }
            : undefined,
          cursor: payload.cursor,
          startedAt,
        }),
        status: AsyncTaskStatus.Pending,
        type: AsyncTaskType.UserMemoryExtractionHourly,
      }));
    let workflowRunId: string;
    try {
      ({ workflowRunId } = await this.triggerHourly(
        { ...payload, hourlyTaskId: taskId },
        { extraHeaders: options?.extraHeaders, workflowRunId: childWorkflowRunId },
      ));
    } catch (error) {
      const statusCode =
        (error as { status?: number; statusCode?: number }).status ??
        (error as { statusCode?: number }).statusCode;
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (
        existingTask &&
        childWorkflowRunId &&
        (statusCode === 409 || message.includes('already'))
      ) {
        await asyncTaskModel.appendUserMemoryWorkflowRunIds(taskId, [childWorkflowRunId]);
        return { taskId, workflowRunId: childWorkflowRunId };
      }

      await asyncTaskModel.update(taskId, {
        error: new AsyncTaskError(
          AsyncTaskErrorType.TaskTriggerError,
          'Failed to schedule hourly memory extraction workflow',
        ),
        status: AsyncTaskStatus.Error,
      });
      throw error;
    }

    await asyncTaskModel.appendUserMemoryWorkflowRunIds(taskId, [workflowRunId]);

    return { taskId, workflowRunId };
  }

  static triggerProcessUserTopics(
    payload: UserTopicWorkflowPayload,
    options?: { extraHeaders?: Record<string, string> },
  ) {
    return getMemoryWorkflowTrigger().triggerProcessUserTopics(payload, options);
  }

  static triggerProcessTopics(
    userId: string,
    payload: MemoryExtractionPayloadInput,
    options?: { extraHeaders?: Record<string, string> },
  ) {
    return getMemoryWorkflowTrigger().triggerProcessTopics(userId, payload, options);
  }

  static triggerProcessTopic(
    userId: string,
    payload: MemoryExtractionPayloadInput,
    options?: { extraHeaders?: Record<string, string> },
  ) {
    return getMemoryWorkflowTrigger().triggerProcessTopic(userId, payload, options);
  }

  static triggerPersonaUpdate(
    userId: string,
    baseUrl: string,
    options?: { extraHeaders?: Record<string, string>; hourlyTaskId?: string },
  ) {
    return getMemoryWorkflowTrigger().triggerPersonaUpdate(userId, baseUrl, options);
  }
}
