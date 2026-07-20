import { MemorySourceType } from '@lobechat/types';
import { type WorkflowContext } from '@upstash/workflow';
import { chunk } from 'es-toolkit/compat';

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

import { checkGuard, ensureWorkflowStarted } from './runGuard';
import { appendHourlyWorkflowRunId, isHourlyMemoryExtractionCancelled } from './utils';

const TOPIC_PAGE_SIZE = 50;
const TOPIC_BATCH_SIZE = 20;
const WORKFLOW_PATH = 'api/workflows/memory-user-memory/pipelines/chat-topic/process-user-topics';
const PROCESS_USER_TOPICS_FLOW_CONTROL_KEY =
  'memory-user-memory.pipelines.chat-topic.process-user-topics';

const { upstashWorkflowExtraHeaders, workflow } = parseMemoryExtractionConfig();

// NOTICE: Hard per-user, per-run fan-out ceiling. flowControl only bounds concurrency, not queue
// depth, so this count cap is what actually prevents one heavy user from backing up a massive
// QStash fan-out. Remaining un-extracted topics resume on later hourly runs, so it self-drains.
const MAX_TOPICS_PER_USER_PER_RUN = workflow?.maxTopicsPerUserPerRun ?? 100;

export const processUserTopicsHandler = async (
  context: WorkflowContext<MemoryExtractionPayloadInput>,
) => {
  await ensureWorkflowStarted(context, WORKFLOW_PATH);

  const params = normalizeMemoryExtractionPayload(context.requestPayload || {});

  // NOTICE: Return (never throw) on a guard match — a throw before the first step makes Upstash
  // re-enqueue the run, turning a "disable" guard into an infinite retry storm.
  const entryGuard = await checkGuard(context, WORKFLOW_PATH);
  if (!entryGuard.result) return entryGuard.response;

  if (!params.userIds.length) {
    return { message: 'No user ids provided for topic processing.' };
  }
  if (!params.sources.includes(MemorySourceType.ChatTopic)) {
    return { message: 'No supported sources requested, skip topic processing.' };
  }

  let executor: Awaited<ReturnType<typeof MemoryExtractionExecutor.create>> | undefined;
  const getExecutor = async () => {
    executor ??= await MemoryExtractionExecutor.create();
    return executor;
  };

  const scheduleNextPage = async (
    userId: string,
    cursorCreatedAt: Date,
    cursorId: string,
    fanoutCount: number,
  ) => {
    return MemoryExtractionWorkflowService.triggerProcessUserTopics(
      {
        ...buildWorkflowPayloadInput({
          ...params,
          topicCursor: {
            createdAt: cursorCreatedAt.toISOString(),
            id: cursorId,
            userId,
          },
          // Carry the running fan-out count so the per-user ceiling spans the whole page chain.
          topicFanoutCount: fanoutCount,
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
      const guard = await checkGuard(context, WORKFLOW_PATH, { stepName });
      if (!guard.result) return guard.response;

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

    const hourlyCancellationStepName = `memory:user-memory:extract:users:${userId}:cancel-check:hourly`;
    const hourlyCancellationGuard = await checkGuard(context, WORKFLOW_PATH, {
      stepName: hourlyCancellationStepName,
    });
    if (!hourlyCancellationGuard.result) return hourlyCancellationGuard.response;

    const hourlyCancelled = await context.run(hourlyCancellationStepName, () =>
      isHourlyMemoryExtractionCancelled(params.hourlyTaskId),
    );
    if (hourlyCancelled) {
      return {
        message: 'Hourly memory extraction task cancellation requested, skip user topic fan-out.',
        processedUsers: 0,
        skipped: true,
      };
    }

    const activeExecutor = await getExecutor();

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
      const guard = await checkGuard(context, WORKFLOW_PATH, { stepName });
      if (!guard.result) return guard.response;

      topicsFromPayload = await context.run(stepName, async () => {
        const filtered = await activeExecutor.filterTopicIdsForUser(
          userId,
          params.topicIds,
          params.workspaceId,
        );
        return filtered.length > 0 ? filtered : undefined;
      });
    }

    const listTopicsStepName = `memory:user-memory:extract:users:${userId}:list-topics:${topicCursor?.id || 'root'}`;
    const listTopicsGuard = await checkGuard(context, WORKFLOW_PATH, {
      stepName: listTopicsStepName,
    });
    if (!listTopicsGuard.result) return listTopicsGuard.response;

    const topicBatch = await context.run<{
      cursor?: ListTopicsForMemoryExtractorCursor;
      ids: string[];
    }>(listTopicsStepName, () =>
      topicsFromPayload && topicsFromPayload.length > 0
        ? Promise.resolve({ ids: topicsFromPayload })
        : activeExecutor.getTopicsForUser(
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

    // NOTICE: Enforce the hard per-user, per-run fan-out ceiling on the paginated discovery path.
    // Explicit topicIds requests (topicsFromPayload) are user-intended and never capped. The count
    // rides in the payload across pages; any topics beyond the ceiling stay un-extracted and are
    // picked up by later hourly runs, so no data is dropped.
    const fanoutCount = params.topicFanoutCount;
    const remainingBudget = topicsFromPayload
      ? ids.length
      : Math.max(0, MAX_TOPICS_PER_USER_PER_RUN - fanoutCount);
    const idsToProcess = topicsFromPayload ? ids : ids.slice(0, remainingBudget);

    for (const [batchIndex, topicIds] of chunk(idsToProcess, TOPIC_BATCH_SIZE).entries()) {
      // NOTICE: We trigger via QStash instead of context.invoke because invoke only swaps the last
      // path segment with the workflowId. If we invoked directly from /process-user-topics, child
      // workflow URLs would inherit that base and lose the desired /process-topics prefix.
      const stepName = `memory:user-memory:extract:users:${userId}:process-topics-batch:${batchIndex}`;
      const guard = await checkGuard(context, WORKFLOW_PATH, { stepName });
      if (!guard.result) return guard.response;

      const result = await context.run(stepName, () =>
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
      await appendHourlyWorkflowRunId(params.hourlyTaskId, result.workflowRunId);
    }

    const nextFanoutCount = fanoutCount + idsToProcess.length;

    // Stop paginating once the per-user ceiling is reached; the remainder resumes next hourly run.
    if (!topicsFromPayload && cursor && nextFanoutCount < MAX_TOPICS_PER_USER_PER_RUN) {
      const hourlyNextPageCancellationStepName = `memory:user-memory:extract:users:${userId}:cancel-check:hourly-next-page`;
      const hourlyNextPageCancellationGuard = await checkGuard(context, WORKFLOW_PATH, {
        stepName: hourlyNextPageCancellationStepName,
      });
      if (!hourlyNextPageCancellationGuard.result) {
        return hourlyNextPageCancellationGuard.response;
      }

      const hourlyNextPageCancelled = await context.run(hourlyNextPageCancellationStepName, () =>
        isHourlyMemoryExtractionCancelled(params.hourlyTaskId),
      );
      if (hourlyNextPageCancelled) {
        return {
          message:
            'Hourly memory extraction task cancellation requested, skip next user topics page.',
          processedUsers: 1,
          skipped: true,
        };
      }

      const stepName = `memory:user-memory:extract:users:${userId}:topics:${cursor.id}:schedule-next-batch`;
      const guard = await checkGuard(context, WORKFLOW_PATH, { stepName });
      if (!guard.result) return guard.response;

      const result = await context.run(stepName, () => {
        // NOTICE: Upstash Workflow only supports serializable data into plain JSON,
        // this causes the Date object to be converted into string when passed as parameter from
        // context to child workflow. So we need to convert it back to Date object here.
        const createdAt = new Date(cursor.createdAt);
        if (Number.isNaN(createdAt.getTime())) {
          throw new Error('Invalid cursor date when scheduling next topic page');
        }

        return scheduleNextPage(userId, createdAt, cursor.id, nextFanoutCount);
      });
      await appendHourlyWorkflowRunId(params.hourlyTaskId, result.workflowRunId);
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
