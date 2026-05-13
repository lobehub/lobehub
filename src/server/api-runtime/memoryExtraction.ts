import type { UserMemoryExtractionMetadata } from '@lobechat/types';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
} from '@lobechat/types';
import { Client as WorkflowClient } from '@upstash/workflow';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { AsyncTaskModel, initUserMemoryExtractionMetadata } from '@/database/models/asyncTask';
import { asyncTasks } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import {
  buildWorkflowPayloadInput,
  MemoryExtractionExecutor,
  memoryExtractionPayloadSchema,
  MemoryExtractionWorkflowService,
  normalizeMemoryExtractionPayload,
} from '@/server/services/memory/userMemory/extract';
import {
  buildUserPersonaJobInput,
  UserPersonaService,
} from '@/server/services/memory/userMemory/persona/service';

const userPersonaWebhookSchema = z.object({
  baseUrl: z.string().url().optional(),
  mode: z.enum(['workflow', 'direct']).optional(),
  userId: z.string().optional(),
  userIds: z.array(z.string()).optional(),
});

const cancelPayloadSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
  taskId: z.string().uuid(),
  userId: z.string().optional(),
  workflowRunId: z.string().optional(),
  workflowRunIds: z.array(z.string()).optional(),
});

type UserPersonaWebhookPayload = z.infer<typeof userPersonaWebhookSchema>;

const normalizeUserPersonaPayload = (
  payload: UserPersonaWebhookPayload,
  fallbackBaseUrl?: string,
) => {
  const parsed = userPersonaWebhookSchema.parse(payload);
  const baseUrl = parsed.baseUrl || fallbackBaseUrl;

  if (!baseUrl) throw new Error('Missing baseUrl for workflow trigger');

  return {
    baseUrl,
    mode: parsed.mode ?? 'workflow',
    userIds: Array.from(
      new Set([...(parsed.userIds || []), ...(parsed.userId ? [parsed.userId] : [])]),
    ).filter(Boolean),
  } as const;
};

const verifyMemoryWebhookHeaders = (request: Request, headers?: Record<string, string>) => {
  if (!headers || Object.keys(headers).length === 0) return;

  for (const [key, value] of Object.entries(headers)) {
    const headerValue = request.headers.get(key);
    if (headerValue !== value) {
      return Response.json(
        { error: `Unauthorized: Missing or invalid header '${key}'` },
        { status: 403 },
      );
    }
  }
};

const getWorkflowClient = () => {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN is required to cancel workflow runs');

  const config: ConstructorParameters<typeof WorkflowClient>[0] = { token };
  if (process.env.QSTASH_URL) {
    (config as Record<string, unknown>).url = process.env.QSTASH_URL;
  }

  return new WorkflowClient(config);
};

export const memoryExtractionWebhookAPIHandler = async (request: Request) => {
  const { webhook, upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();

  const unauthorizedResponse = verifyMemoryWebhookHeaders(request, webhook.headers);
  if (unauthorizedResponse) return unauthorizedResponse;

  try {
    const json = await request.json();
    const origin = new URL(request.url).origin;

    const payload = memoryExtractionPayloadSchema.parse({
      ...json,
      baseUrl: json.baseUrl || origin,
    });
    if (payload.fromDate && payload.toDate && payload.fromDate > payload.toDate) {
      return Response.json({ error: '`fromDate` cannot be later than `toDate`' }, { status: 400 });
    }

    const params = normalizeMemoryExtractionPayload(payload, origin);
    if (params.mode === 'workflow') {
      const { workflowRunId } = await MemoryExtractionWorkflowService.triggerProcessUsers(
        buildWorkflowPayloadInput(params),
        { extraHeaders: upstashWorkflowExtraHeaders },
      );

      return Response.json(
        { message: 'Memory extraction scheduled via workflow.', workflowRunId },
        { status: 202 },
      );
    }

    const executor = await MemoryExtractionExecutor.create();
    const result = await executor.runDirect(params);

    return Response.json(
      { message: 'Memory extraction executed via webhook.', result },
      { status: 200 },
    );
  } catch (error) {
    console.error('[memory-extraction] failed', error);

    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
};

export const memoryUserPersonaUpdateWritingWebhookAPIHandler = async (request: Request) => {
  const { upstashWorkflowExtraHeaders, webhook } = parseMemoryExtractionConfig();

  const unauthorizedResponse = verifyMemoryWebhookHeaders(request, webhook.headers);
  if (unauthorizedResponse) return unauthorizedResponse;

  try {
    const json = await request.json();
    const origin = new URL(request.url).origin;
    const params = normalizeUserPersonaPayload(json, webhook.baseUrl || origin);

    if (params.userIds.length === 0) {
      return Response.json({ error: 'userId or userIds is required' }, { status: 400 });
    }

    if (params.mode === 'workflow') {
      const results = await Promise.all(
        params.userIds.map(async (userId) => {
          const { workflowRunId } = await MemoryExtractionWorkflowService.triggerPersonaUpdate(
            userId,
            params.baseUrl,
            { extraHeaders: upstashWorkflowExtraHeaders },
          );

          return { userId, workflowRunId };
        }),
      );

      return Response.json(
        { message: 'User persona update scheduled via workflow.', results },
        { status: 202 },
      );
    }

    const db = await getServerDB();
    const service = new UserPersonaService(db);
    const results = [];

    for (const userId of params.userIds) {
      const context = await buildUserPersonaJobInput(db, userId);
      const result = await service.composeWriting({ ...context, userId });
      results.push({ userId, ...result });
    }

    return Response.json(
      { message: 'User persona generated via webhook.', results },
      { status: 200 },
    );
  } catch (error) {
    console.error('[user-persona] failed', error);

    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
};

export const memoryExtractChatTopicCancelWebhookAPIHandler = async (request: Request) => {
  const { webhook } = parseMemoryExtractionConfig();

  const unauthorizedResponse = verifyMemoryWebhookHeaders(request, webhook.headers);
  if (unauthorizedResponse) return unauthorizedResponse;

  try {
    const payload = cancelPayloadSchema.parse(await request.json());
    const db = await getServerDB();

    const task = await db.query.asyncTasks.findFirst({
      where: and(
        eq(asyncTasks.id, payload.taskId),
        eq(asyncTasks.type, AsyncTaskType.UserMemoryExtractionWithChatTopic),
      ),
    });

    if (!task) {
      return Response.json(
        { error: `Memory extraction task not found for id '${payload.taskId}'` },
        { status: 404 },
      );
    }

    if (payload.userId && payload.userId !== task.userId) {
      return Response.json(
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

    return Response.json(
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

    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
};
