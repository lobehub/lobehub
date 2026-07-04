import { MemorySourceType } from '@lobechat/types';
import { type WorkflowContext } from '@upstash/workflow';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { type ListTopicsForMemoryExtractorCursor } from '@/database/models/topic';
import { getServerDB } from '@/database/server';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { type MemoryExtractionPayloadInput } from '@/server/services/memory/userMemory/extract';
import {
  buildWorkflowPayloadInput,
  MemoryExtractionExecutor,
  MemoryExtractionWorkflowService,
  normalizeMemoryExtractionPayload,
} from '@/server/services/memory/userMemory/extract';
import { forEachBatchSequential } from '@/server/services/memory/userMemory/topicBatching';

import { assertMemoryWorkflowContextAllowed } from './runGuard';

const TOPIC_PAGE_SIZE = 50;
const TOPIC_BATCH_SIZE = 4;
const WORKFLOW_PATH = 'api/workflows/memory-user-memory/pipelines/chat-topic/process-user-topics';
const PROCESS_USER_TOPICS_FLOW_CONTROL_KEY =
  'memory-user-memory.pipelines.chat-topic.process-user-topics';

const { upstashWorkflowExtraHeaders, workflow } = parseMemoryExtractionConfig();

export const processUserTopicsHandler = async (
  context: WorkflowContext<MemoryExtractionPayloadInput>,
) => {
  const params = normalizeMemoryExtractionPayload(context.requestPayload || {});
  await assertMemoryWorkflowContextAllowed(context, WORKFLOW_PATH);

  if (!params.userIds.length) {
    return { message: 'No user ids provided for topic processing.' };
  }
  if (!params.sources.includes(MemorySourceType.ChatTopic)) {
    return { message: 'No supported sources requested, skip topic processing.' };
  }

  const executor = await MemoryExtractionExecutor.create();

  const scheduleNextPage = async (userId: string, cursorCreatedAt: Date, cursorId: string) => {
    await MemoryExtractionWorkflowService.triggerProcessUserTopics(
      {
        ...buildWorkflowPayloadInput({
          ...params,
          topicCursor: {
            createdAt: cursorCreatedAt.toISOString(),
            id: cursorId,
            userId,
          },
          topicIds: [],
          userId,
          userIds: [userId],
        }),
      },
      { extraHeaders: upstashWorkflowExtraHeaders },
    );
  };

  for (const userId of params.userIds) {
    if (params.asyncTaskId) {
      // NOTICE: Cooperative cascading cancellation for the workflow tree.
      // A cancelled root task should stop at user-topic pagination and avoid enqueuing topic batches.
      const stepName = `memory:user-memory:extract:users:${userId}:cancel-check`;
      await assertMemoryWorkflowContextAllowed(context, WORKFLOW_PATH, stepName);
      const cancelled = await context.run(stepName, () =>
        getServerDB().then((db) =>
          new AsyncTaskModel(
            db,
            userId,
            params.workspaceId,
          ).isUserMemoryExtractionCancellationRequested(params.asyncTaskId!),
        ),
      );
      if (cancelled) {
        continue;
      }
    }

    const topicCursor =
      params.topicCursor && params.topicCursor.userId === userId
        ? {
            createdAt: new Date(params.topicCursor.createdAt),
            id: params.topicCursor.id,
          }
        : undefined;

    let topicsFromPayload: string[] | undefined;
    if (params.topicIds && params.topicIds.length > 0) {
      const stepName = `memory:user-memory:extract:users:${userId}:filter-topic-ids`;
      await assertMemoryWorkflowContextAllowed(context, WORKFLOW_PATH, stepName);
      topicsFromPayload = await context.run(stepName, async () => {
        const filtered = await executor.filterTopicIdsForUser(
          userId,
          params.topicIds,
          params.workspaceId,
        );
        return filtered.length > 0 ? filtered : undefined;
      });
    }

    const listTopicsStepName = `memory:user-memory:extract:users:${userId}:list-topics:${topicCursor?.id || 'root'}`;
    await assertMemoryWorkflowContextAllowed(context, WORKFLOW_PATH, listTopicsStepName);
    const topicBatch = await context.run<{
      cursor?: ListTopicsForMemoryExtractorCursor;
      ids: string[];
    }>(listTopicsStepName, () =>
      topicsFromPayload && topicsFromPayload.length > 0
        ? Promise.resolve({ ids: topicsFromPayload })
        : executor.getTopicsForUser(
            {
              cursor: topicCursor,
              forceAll: params.forceAll,
              forceTopics: params.forceTopics,
              from: params.from,
              to: params.to,
              userId,
              workspaceId: params.workspaceId,
            },
            TOPIC_PAGE_SIZE,
          ),
    );

    const ids = topicBatch.ids;
    if (!ids.length) {
      continue;
    }

    const cursor = 'cursor' in topicBatch ? topicBatch.cursor : undefined;

    // TODO: follow the new pattern of process-topic
    // remove the batch sequential, replace it with context.invoke(...) pattern
    await forEachBatchSequential(ids, TOPIC_BATCH_SIZE, async (topicIds, batchIndex) => {
      // NOTICE: We trigger via QStash instead of context.invoke because invoke only swaps the last path
      // segment with the workflowId. If we invoked directly from /process-user-topics, child workflow
      // URLs would inherit that base and lose the desired /process-topics/workflows prefix.
      const stepName = `memory:user-memory:extract:users:${userId}:process-topics-batch:${batchIndex}`;
      await assertMemoryWorkflowContextAllowed(context, WORKFLOW_PATH, stepName);
      await context.run(stepName, () =>
        MemoryExtractionWorkflowService.triggerProcessTopics(
          userId,
          {
            ...buildWorkflowPayloadInput(params),
            topicCursor: undefined,
            topicIds,
            userId,
            userIds: [userId],
          },
          { extraHeaders: upstashWorkflowExtraHeaders },
        ),
      );
    });

    if (!topicsFromPayload && cursor) {
      const stepName = `memory:user-memory:extract:users:${userId}:topics:${cursor.id}:schedule-next-batch`;
      await assertMemoryWorkflowContextAllowed(context, WORKFLOW_PATH, stepName);
      await context.run(stepName, () => {
        // NOTICE: Upstash Workflow only supports serializable data into plain JSON,
        // this causes the Date object to be converted into string when passed as parameter from
        // context to child workflow. So we need to convert it back to Date object here.
        const createdAt = new Date(cursor.createdAt);
        if (Number.isNaN(createdAt.getTime())) {
          throw new Error('Invalid cursor date when scheduling next topic page');
        }

        return scheduleNextPage(userId, createdAt, cursor.id);
      });
    }
  }

  return { processedUsers: params.userIds.length };
};

/**
 * Shared flow-control settings for active user-topic workers.
 *
 * Use when:
 * - Serving process-user-topics workflow runs through Upstash Workflow
 * - Keeping memory extraction bounded to the configured active user worker limit
 *
 * Expects:
 * - Trigger-side calls use the same key to throttle initial workflow delivery
 *
 * Returns:
 * - Upstash Workflow serve options that limit process-user-topics executions
 */
export const processUserTopicsWorkflowOptions = {
  // NOTICE: This key intentionally omits userId. Adding userId would create one independent
  // bucket per user and would not cap total database pressure; the global key keeps at most
  // the configured number of user-topic workers active across all users.
  flowControl: {
    key: PROCESS_USER_TOPICS_FLOW_CONTROL_KEY,
    parallelism: workflow?.processUserTopicsParallelism ?? 25,
  },
};
