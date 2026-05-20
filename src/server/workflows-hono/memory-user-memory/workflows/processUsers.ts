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

const USER_PAGE_SIZE = 50;
const USER_BATCH_SIZE = 10;

const { upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();

export const processUsersHandler = async (
  context: WorkflowContext<MemoryExtractionPayloadInput>,
) => {
  const params = normalizeMemoryExtractionPayload(context.requestPayload || {});
  if (params.sources.length === 0) {
    return { message: 'No sources provided, skip memory extraction.' };
  }
  if (params.asyncTaskId && params.userIds[0]) {
    // NOTICE: Cooperative cascading cancellation for the workflow tree.
    // If root task has cancelRequestedAt, this stage stops scheduling child workflows.
    const cancelled = await context.run('memory:user-memory:extract:cancel-check:root', () =>
      getServerDB().then((db) =>
        new AsyncTaskModel(db, params.userIds[0]!).isUserMemoryExtractionCancellationRequested(
          params.asyncTaskId!,
        ),
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

  const userBatch = await context.run('memory:user-memory:extract:get-users', () =>
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
    batches.map((userIds) =>
      context.run(`memory:user-memory:extract:users:process-topic-batches`, () =>
        MemoryExtractionWorkflowService.triggerProcessUserTopics(
          {
            ...buildWorkflowPayloadInput(params),
            topicCursor: undefined,
            userId: userIds[0],
            userIds,
          },
          { extraHeaders: upstashWorkflowExtraHeaders },
        ),
      ),
    ),
  );

  if (params.userIds.length === 0 && cursor) {
    await context.run('memory:user-memory:extract:users:schedule-next-user-batch', () =>
      MemoryExtractionWorkflowService.triggerProcessUsers(
        {
          ...buildWorkflowPayloadInput({
            ...params,
            userCursor: { createdAt: cursor.createdAt.toISOString(), id: cursor.id },
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
