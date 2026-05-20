import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
  type UserMemoryExtractionMetadata,
} from '@lobechat/types';
import { Client as WorkflowClient } from '@upstash/workflow';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { AsyncTaskModel, initUserMemoryExtractionMetadata } from '@/database/models/asyncTask';
import { asyncTasks } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';

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

export const POST = async (req: Request) => {
  const { webhook } = parseMemoryExtractionConfig();

  if (webhook.headers && Object.keys(webhook.headers).length > 0) {
    for (const [key, value] of Object.entries(webhook.headers)) {
      const headerValue = req.headers.get(key);
      if (headerValue !== value) {
        return NextResponse.json(
          { error: `Unauthorized: Missing or invalid header '${key}'` },
          { status: 403 },
        );
      }
    }
  }

  try {
    const payload = cancelPayloadSchema.parse(await req.json());
    const db = await getServerDB();

    const task = await db.query.asyncTasks.findFirst({
      where: and(
        eq(asyncTasks.id, payload.taskId),
        eq(asyncTasks.type, AsyncTaskType.UserMemoryExtractionWithChatTopic),
      ),
    });

    if (!task) {
      return NextResponse.json(
        { error: `Memory extraction task not found for id '${payload.taskId}'` },
        { status: 404 },
      );
    }

    if (payload.userId && payload.userId !== task.userId) {
      return NextResponse.json(
        { error: `Task '${payload.taskId}' does not belong to the provided userId` },
        { status: 403 },
      );
    }

    const metadata = initUserMemoryExtractionMetadata(
      task.metadata as UserMemoryExtractionMetadata | undefined,
    );

    const workflowRunIds = Array.from(
      new Set([
        ...(metadata.control?.upstash?.workflowRunIds || []),
        ...(payload.workflowRunId ? [payload.workflowRunId] : []),
        ...(payload.workflowRunIds || []),
      ]),
    );

    const nextMetadata: UserMemoryExtractionMetadata = {
      ...metadata,
      control: {
        cancelReason: payload.reason || metadata.control?.cancelReason,
        cancelRequestedAt: metadata.control?.cancelRequestedAt || new Date().toISOString(),
        cancelledBy: 'webhook',
        upstash: {
          workflowRunIds,
        },
      },
    };

    const asyncTaskModel = new AsyncTaskModel(db, task.userId);
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

    return NextResponse.json(
      {
        cancelledWorkflowRuns,
        message: 'Memory extraction cancellation has been requested.',
        status: AsyncTaskStatus.Error,
        taskId: task.id,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[memory-user-memory/pipelines/extract/chat-topic/cancel] failed', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
};
