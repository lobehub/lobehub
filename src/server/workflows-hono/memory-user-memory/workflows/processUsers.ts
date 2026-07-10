import { type WorkflowContext } from '@upstash/workflow';
import { chunk } from 'es-toolkit/compat';

import { AsyncTaskModel } from '@/database/models/asyncTask';
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
import { serializeWorkflowCursor } from './utils';

const USER_PAGE_SIZE = 50;
const USER_BATCH_SIZE = 10;
const WORKFLOW_PATH = 'api/workflows/memory-user-memory/pipelines/chat-topic/process-users';
const PROCESS_USERS_FLOW_CONTROL_KEY = 'memory-user-memory.pipelines.chat-topic.process-users';

const { upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();

export const processUsersHandler = async (
  context: WorkflowContext<MemoryExtractionPayloadInput>,
) => {
  await ensureWorkflowStarted(context, WORKFLOW_PATH);

  const params = normalizeMemoryExtractionPayload(context.requestPayload || {});

  // NOTICE: Return (never throw) on a guard match — a throw before the first step makes Upstash
  // re-enqueue the run, turning a "disable" guard into an infinite retry storm.
  const entryGuard = await checkGuard(context, WORKFLOW_PATH);
  if (!entryGuard.result) return entryGuard.response;

  if (params.sources.length === 0) {
    return { message: 'No sources provided, skip memory extraction.' };
  }
  if (params.asyncTaskId && params.userIds[0]) {
    // NOTICE: Cooperative cascading cancellation for the workflow tree.
    // If root task has cancelRequestedAt, this stage stops scheduling child workflows.
    const stepName = 'memory:user-memory:extract:cancel-check:root';
    const guard = await checkGuard(context, WORKFLOW_PATH, { stepName });
    if (!guard.result) return guard.response;

    const cancelled = await context.run(stepName, () =>
      getServerDB().then((db) =>
        new AsyncTaskModel(
          db,
          params.userIds[0]!,
          params.workspaceId,
        ).isUserMemoryExtractionCancellationRequested(params.asyncTaskId!),
      ),
    );
    if (cancelled) {
      return { message: 'Memory extraction task cancellation requested, skip processing users.' };
    }
  }

  const executor = await MemoryExtractionExecutor.create();

  // NOTICE: Upstash Workflow only supports serializable data into plain JSON,
  // this causes the Date object to be converted into string when passed as parameter from
  // context to child workflow. So we need to convert it back to Date object here.
  const userCursor = params.userCursor
    ? { createdAt: new Date(params.userCursor.createdAt), id: params.userCursor.id }
    : undefined;

  const getUsersStepName = 'memory:user-memory:extract:get-users';
  const getUsersGuard = await checkGuard(context, WORKFLOW_PATH, { stepName: getUsersStepName });
  if (!getUsersGuard.result) return getUsersGuard.response;

  const userBatch = await context.run(getUsersStepName, () =>
    params.userIds.length > 0
      ? { ids: params.userIds }
      : executor.getUsers(USER_PAGE_SIZE, userCursor),
  );

  const ids = userBatch.ids;
  if (ids.length === 0) {
    return { message: 'No users to process for memory extraction.' };
  }

  const cursor = 'cursor' in userBatch ? userBatch.cursor : undefined;

  const batches = chunk(ids, USER_BATCH_SIZE);
  for (const [index, userIds] of batches.entries()) {
    const stepName = `memory:user-memory:extract:users:process-topic-batches:${index}`;
    const guard = await checkGuard(context, WORKFLOW_PATH, { stepName });
    if (!guard.result) return guard.response;

    await context.run(stepName, () =>
      MemoryExtractionWorkflowService.triggerProcessUserTopics(
        {
          ...buildWorkflowPayloadInput(params),
          topicCursor: undefined,
          userId: userIds[0],
          userIds,
        },
        { extraHeaders: upstashWorkflowExtraHeaders },
      ),
    );
  }

  if (params.userIds.length === 0 && cursor) {
    const stepName = 'memory:user-memory:extract:users:schedule-next-user-batch';
    const guard = await checkGuard(context, WORKFLOW_PATH, { stepName });
    if (!guard.result) return guard.response;

    await context.run(stepName, () =>
      MemoryExtractionWorkflowService.triggerProcessUsers(
        {
          ...buildWorkflowPayloadInput({
            ...params,
            userCursor: serializeWorkflowCursor(
              cursor,
              'Invalid cursor date when scheduling next user page',
            ),
          }),
        },
        { extraHeaders: upstashWorkflowExtraHeaders },
      ),
    );
  }

  return {
    batches: batches.length,
    nextCursor: cursor ? cursor.id : null,
    processedUsers: ids.length,
  };
};

/**
 * Shared flow-control settings for the process-users workflow.
 *
 * Use when:
 * - Serving process-users workflow runs through Upstash Workflow
 * - Keeping hourly/user-triggered process-users runs from executing unbounded work concurrently
 *
 * Expects:
 * - Trigger-side workflow calls use the same key to throttle initial workflow delivery
 *
 * Returns:
 * - Upstash Workflow serve options that limit follow-up workflow steps
 */
export const processUsersWorkflowOptions = {
  // NOTICE: Serve-side flow control only applies after a workflow run has entered Upstash
  // Workflow execution. triggerProcessUsers must pass the same key so initial deliveries
  // are throttled before many process-users runs can start at once.
  flowControl: {
    key: PROCESS_USERS_FLOW_CONTROL_KEY,
    parallelism: 1,
    ratePerSecond: 1,
  },
};
