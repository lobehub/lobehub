import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
  type HourlyUserMemoryExtractionMetadata,
  type UserMemoryExtractionMetadata,
} from '@lobechat/types';
import { Client as WorkflowClient } from '@upstash/workflow';
import { and, eq, inArray } from 'drizzle-orm';
import type { Context } from 'hono';
import { z } from 'zod';

import {
  AsyncTaskModel,
  initHourlyUserMemoryExtractionMetadata,
  initUserMemoryExtractionMetadata,
} from '@/database/models/asyncTask';
import { asyncTasks } from '@/database/schemas';
import { getServerDB } from '@/database/server';

const cancelPayloadSchema = z.object({
  // Optional human-readable cancellation reason.
  reason: z.string().trim().max(1000).optional(),
  // Async task id for user memory extraction.
  taskId: z.string().uuid(),
  // Optional ownership guard; when provided, must match task owner.
  userId: z.string().optional(),
  // Optional single workflow run id associated with the task.
  workflowRunId: z.string().optional(),
  // Optional additional workflow run ids for bulk cancellation.
  workflowRunIds: z.array(z.string()).optional(),
});

const getWorkflowClient = () => {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN is required to cancel workflow runs');

  const config: ConstructorParameters<typeof WorkflowClient>[0] = { token };
  if (process.env.QSTASH_URL) {
    (config as Record<string, unknown>).url = process.env.QSTASH_URL;
  }

  return new WorkflowClient(config);
};

const supportedTaskTypes = [
  AsyncTaskType.UserMemoryExtractionHourly,
  AsyncTaskType.UserMemoryExtractionWithChatTopic,
];

const initMemoryExtractionMetadata = (task: typeof asyncTasks.$inferSelect) => {
  if (task.type === AsyncTaskType.UserMemoryExtractionHourly) {
    const metadata = task.metadata as Partial<HourlyUserMemoryExtractionMetadata> | undefined;

    return initHourlyUserMemoryExtractionMetadata({
      ...metadata,
      startedAt: metadata?.startedAt || task.createdAt?.toISOString() || new Date().toISOString(),
    });
  }

  return initUserMemoryExtractionMetadata(
    task.metadata as UserMemoryExtractionMetadata | undefined,
  );
};

/**
 * Cancels an in-flight user-memory extraction task and its Upstash workflow runs.
 *
 * Header auth is applied by the `memoryWebhookAuth` middleware.
 */
export const memoryUserMemoryChatTopicCancel = async (c: Context) => {
  try {
    const payload = cancelPayloadSchema.parse(await c.req.json());
    const db = await getServerDB();

    const task = await db.query.asyncTasks.findFirst({
      where: and(eq(asyncTasks.id, payload.taskId), inArray(asyncTasks.type, supportedTaskTypes)),
    });

    if (!task) {
      return c.json({ error: `Memory extraction task not found for id '${payload.taskId}'` }, 404);
    }

    if (payload.userId && payload.userId !== task.userId) {
      return c.json(
        { error: `Task '${payload.taskId}' does not belong to the provided userId` },
        403,
      );
    }

    const metadata = initMemoryExtractionMetadata(task);

    const workflowRunIds = Array.from(
      new Set([
        ...(metadata.control?.upstash?.workflowRunIds || []),
        ...(payload.workflowRunId ? [payload.workflowRunId] : []),
        ...(payload.workflowRunIds || []),
      ]),
    );

    const nextMetadata: typeof metadata = {
      ...metadata,
      control: {
        cancelReason: payload.reason || metadata.control?.cancelReason,
        cancelRequestedAt: metadata.control?.cancelRequestedAt || new Date().toISOString(),
        cancelledBy: 'webhook',
        upstash: {
          ...metadata.control?.upstash,
          workflowRunIds,
        },
      },
    };

    const asyncTaskModel = new AsyncTaskModel(db, task.userId, task.workspaceId ?? undefined);
    await asyncTaskModel.update(task.id, {
      error: new AsyncTaskError(
        AsyncTaskErrorType.TaskCancelled,
        payload.reason || 'Memory extraction cancelled from webhook',
      ),
      metadata: nextMetadata,
      status: AsyncTaskStatus.Error,
    });

    let cancelledWorkflowRuns = 0;
    if (workflowRunIds.length > 0) {
      try {
        const result = await getWorkflowClient().cancel({ ids: workflowRunIds });
        cancelledWorkflowRuns = result.cancelled || 0;
      } catch (error) {
        console.error(
          '[memory-user-memory/pipelines/extract/chat-topic/cancel] failed to cancel workflow runs',
          error,
        );
      }
    }

    return c.json(
      {
        cancelledWorkflowRuns,
        message: 'Memory extraction cancellation has been requested.',
        status: AsyncTaskStatus.Error,
        taskId: task.id,
      },
      200,
    );
  } catch (error) {
    console.error('[memory-user-memory/pipelines/extract/chat-topic/cancel] failed', error);
    return c.json({ error: (error as Error).message }, 500);
  }
};
