import type { FlowControl } from '@upstash/qstash';
import type { Client } from '@upstash/workflow';
import { and, eq, sql } from 'drizzle-orm';

import {
  AsyncTaskModel,
  initHourlyUserMemoryExtractionMetadata,
} from '@/database/models/asyncTask';
import { asyncTasks } from '@/database/schemas';
import { getServerDB } from '@/database/server';
import { OtelWorkflowClient } from '@/libs/qstash';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
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

const WORKFLOW_PATHS = {
  consolidation: '/api/workflows/memory-user-memory/pipelines/consolidation/run',
  hourly: '/api/workflows/memory-user-memory/call-cron-hourly-analysis',
  personaUpdate: '/api/workflows/memory-user-memory/pipelines/persona/update-writing',
  topic: '/api/workflows/memory-user-memory/pipelines/chat-topic/process-topic',
  topicBatch: '/api/workflows/memory-user-memory/pipelines/chat-topic/process-topics',
  userTopics: '/api/workflows/memory-user-memory/pipelines/chat-topic/process-user-topics',
  users: '/api/workflows/memory-user-memory/pipelines/chat-topic/process-users',
} as const;

const PROCESS_USERS_FLOW_CONTROL = {
  key: 'memory-user-memory.pipelines.chat-topic.process-users',
  parallelism: 1,
  ratePerSecond: 1,
} satisfies FlowControl;

const getProcessUserTopicsFlowControl = (): FlowControl => {
  const { workflow } = parseMemoryExtractionConfig();

  return {
    key: 'memory-user-memory.pipelines.chat-topic.process-user-topics',
    // NOTICE: Trigger-side flow control is required for initial workflow delivery.
    // A serve() flowControl setting alone is applied after the run starts, so it cannot prevent
    // many process-user-topics runs from entering execution at the same time.
    parallelism: workflow?.processUserTopicsParallelism ?? 25,
  };
};

const buildHourlyChildWorkflowRunId = (entryWorkflowRunId: string) =>
  `memory-user-memory-hourly-${entryWorkflowRunId.replaceAll(/[^\w-]/g, '_')}`;

const getWorkflowUrl = (path: string, baseUrl: string) => {
  const url = new URL(path, baseUrl);

  return url.toString();
};

const getWorkflowClient = () => {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN is required to trigger workflows');

  const config: ConstructorParameters<typeof Client>[0] = { token };

  if (process.env.QSTASH_URL) {
    (config as Record<string, unknown>).url = process.env.QSTASH_URL;
  }

  return new OtelWorkflowClient(config);
};

export class MemoryExtractionWorkflowService {
  private static client: Client;

  private static getClient() {
    if (!this.client) {
      this.client = getWorkflowClient();
    }

    return this.client;
  }

  static triggerProcessUsers(
    payload: MemoryExtractionPayloadInput,
    options?: { extraHeaders?: Record<string, string> },
  ) {
    if (!payload.baseUrl) {
      throw new Error('Missing baseUrl for workflow trigger');
    }

    const url = getWorkflowUrl(WORKFLOW_PATHS.users, payload.baseUrl);
    return this.getClient().trigger({
      body: payload,
      flowControl: PROCESS_USERS_FLOW_CONTROL,
      headers: options?.extraHeaders,
      url,
    });
  }

  static triggerHourly(
    payload: MemoryExtractionHourlyWorkflowPayload,
    options?: { extraHeaders?: Record<string, string>; workflowRunId?: string },
  ) {
    if (!payload.baseUrl) {
      throw new Error('Missing baseUrl for workflow trigger');
    }

    const url = getWorkflowUrl(WORKFLOW_PATHS.hourly, payload.baseUrl);
    return this.getClient().trigger({
      body: payload,
      headers: options?.extraHeaders,
      url,
      workflowRunId: options?.workflowRunId,
    });
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
   * - The created async task id and root Upstash workflow run id
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
    if (!payload.baseUrl) {
      throw new Error('Missing baseUrl for workflow trigger');
    }

    const url = getWorkflowUrl(WORKFLOW_PATHS.userTopics, payload.baseUrl);
    return this.getClient().trigger({
      body: payload,
      flowControl: getProcessUserTopicsFlowControl(),
      headers: options?.extraHeaders,
      url,
    });
  }

  static triggerProcessTopics(
    userId: string,
    payload: MemoryExtractionPayloadInput,
    options?: { extraHeaders?: Record<string, string> },
  ) {
    if (!payload.baseUrl) {
      throw new Error('Missing baseUrl for workflow trigger');
    }

    const url = getWorkflowUrl(WORKFLOW_PATHS.topicBatch, payload.baseUrl);
    return this.getClient().trigger({
      body: payload,
      flowControl: {
        key: `memory-user-memory.pipelines.chat-topic.process-topics.user.${userId}`,
        // NOTICE: Each process-topics workflow currently invokes topic workflows sequentially.
        // Parallelism 20 therefore bounds each user's active topic extraction workflows to 20.
        // If process-topics changes back to parallel per-topic invoke, divide this number by
        // the per-batch topic concurrency to preserve the same per-user topic budget.
        parallelism: 20,
      },
      headers: options?.extraHeaders,
      url,
    });
  }

  static triggerProcessTopic(
    userId: string,
    payload: MemoryExtractionPayloadInput,
    options?: { extraHeaders?: Record<string, string> },
  ) {
    if (!payload.baseUrl) {
      throw new Error('Missing baseUrl for workflow trigger');
    }

    const url = getWorkflowUrl(WORKFLOW_PATHS.topic, payload.baseUrl);
    return this.getClient().trigger({
      body: payload,
      // NOTICE: fire-and-forget fan-out (replaces the old context.invoke). The per-user key bounds
      // how many process-topic runs a single user can start concurrently, so one heavy user can't
      // monopolize extraction. Serve-side flow control (processTopicWorkflowOptions) additionally
      // keeps this workflow's own step-continuation messages out of the shared "$" (unbound) bucket.
      flowControl: {
        key: `memory-user-memory.pipelines.chat-topic.process-topic.user.${userId}`,
        parallelism: 5,
      } satisfies FlowControl,
      headers: options?.extraHeaders,
      url,
    });
  }

  /** One consolidation run per user at a time: the flow-control key is per user. */
  static triggerConsolidation(
    userId: string,
    baseUrl: string,
    options?: { extraHeaders?: Record<string, string>; model?: string; provider?: string },
  ) {
    if (!baseUrl) {
      throw new Error('Missing baseUrl for workflow trigger');
    }

    const url = getWorkflowUrl(WORKFLOW_PATHS.consolidation, baseUrl);
    return this.getClient().trigger({
      body: { model: options?.model, provider: options?.provider, userId },
      flowControl: {
        key: `memory-user-memory.pipelines.consolidation.${userId}`,
        parallelism: 1,
      } satisfies FlowControl,
      headers: options?.extraHeaders,
      url,
    });
  }

  static triggerPersonaUpdate(
    userId: string,
    baseUrl: string,
    options?: { extraHeaders?: Record<string, string>; hourlyTaskId?: string },
  ) {
    if (!baseUrl) {
      throw new Error('Missing baseUrl for workflow trigger');
    }

    const url = getWorkflowUrl(WORKFLOW_PATHS.personaUpdate, baseUrl);
    return this.getClient().trigger({
      body: { hourlyTaskId: options?.hourlyTaskId, userIds: [userId] },
      flowControl: {
        key: `memory-user-memory.pipelines.persona.update-write.${userId}`,
        parallelism: 1,
      } satisfies FlowControl,
      headers: options?.extraHeaders,
      url,
    });
  }
}
