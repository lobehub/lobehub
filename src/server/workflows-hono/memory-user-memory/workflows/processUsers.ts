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

import { assertMemoryWorkflowContextAllowed } from './runGuard';
import { serializeWorkflowCursor } from './utils';

const USER_PAGE_SIZE = 50;
const USER_BATCH_SIZE = 10;
const WORKFLOW_PATH = 'api/workflows/memory-user-memory/pipelines/chat-topic/process-users';

const { upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();

export const processUsersHandler = async (
  context: WorkflowContext<MemoryExtractionPayloadInput>,
) => {
  const params = normalizeMemoryExtractionPayload(context.requestPayload || {});
  await assertMemoryWorkflowContextAllowed(context, WORKFLOW_PATH);

  if (params.sources.length === 0) {
    return { message: 'No sources provided, skip memory extraction.' };
  }
  if (params.asyncTaskId && params.userIds[0]) {
    // NOTICE: Cooperative cascading cancellation for the workflow tree.
    // If root task has cancelRequestedAt, this stage stops scheduling child workflows.
    const stepName = 'memory:user-memory:extract:cancel-check:root';
    await assertMemoryWorkflowContextAllowed(context, WORKFLOW_PATH, stepName);
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
  await assertMemoryWorkflowContextAllowed(context, WORKFLOW_PATH, getUsersStepName);
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
  await Promise.all(
    batches.map(async (userIds) => {
      const stepName = 'memory:user-memory:extract:users:process-topic-batches';
      await assertMemoryWorkflowContextAllowed(context, WORKFLOW_PATH, stepName);

      return context.run(stepName, () =>
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
    }),
  );

  if (params.userIds.length === 0 && cursor) {
    const stepName = 'memory:user-memory:extract:users:schedule-next-user-batch';
    await assertMemoryWorkflowContextAllowed(context, WORKFLOW_PATH, stepName);
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
