import { MemorySourceType } from '@lobechat/types';
import { type WorkflowContext } from '@upstash/workflow';
import { chunk } from 'es-toolkit/compat';

import { appEnv } from '@/envs/app';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import {
  buildWorkflowPayloadInput,
  MemoryExtractionExecutor,
  type MemoryExtractionHourlyWorkflowPayload,
  MemoryExtractionWorkflowService,
  normalizeMemoryExtractionPayload,
} from '@/server/services/memory/userMemory/extract';

import { resolveMemoryWorkflowRunGuard } from './runGuard';
import { serializeWorkflowCursor } from './utils';

const USER_PAGE_SIZE = 200;
const USER_BATCH_SIZE = 20;
const WORKFLOW_PATH = 'api/workflows/memory-user-memory/call-cron-hourly-analysis';

const { webhook, upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();

const resolveBaseUrl = () => webhook.baseUrl || appEnv.INTERNAL_APP_URL || appEnv.APP_URL;

export const hourlyWorkflowHandler = async (
  context: WorkflowContext<MemoryExtractionHourlyWorkflowPayload>,
) => {
  const { cursor, dryRun } = context.requestPayload || {};

  // NOTICE: A run guard match must terminate the workflow by returning, never by throwing.
  // Throwing before the first step makes Upstash re-enqueue the run, turning a "disable" guard
  // into an infinite retry storm.
  const guardBlock = await resolveMemoryWorkflowRunGuard(context, WORKFLOW_PATH);
  if (guardBlock) {
    return {
      message: `Memory workflow disabled by run guard (${guardBlock.reason ?? guardBlock.scope}); skipping.`,
      processedUsers: 0,
      skipped: true,
    };
  }

  const baseUrl = resolveBaseUrl();
  if (!baseUrl) {
    throw new Error('Missing baseUrl for hourly memory extraction workflow');
  }

  const parsedCursor = cursor
    ? { createdAt: new Date(cursor.createdAt), id: cursor.id }
    : undefined;
  if (parsedCursor && Number.isNaN(parsedCursor.createdAt.getTime())) {
    throw new Error('Invalid cursor date for hourly memory extraction workflow');
  }

  const executor = await MemoryExtractionExecutor.create();
  const listUsersStepName = `memory:user-memory:hourly:list-users:${parsedCursor?.id || 'root'}`;
  const userBatch = await context.run(listUsersStepName, () =>
    executor.getUsersForHourlyExtraction(USER_PAGE_SIZE, parsedCursor),
  );

  const userIds = userBatch.ids;
  if (userIds.length === 0) {
    return { message: 'No eligible users for hourly memory extraction.', processedUsers: 0 };
  }

  const nextCursor = userBatch.cursor
    ? serializeWorkflowCursor(
        userBatch.cursor,
        'Invalid cursor date for hourly memory extraction workflow',
      )
    : undefined;

  if (!dryRun) {
    const batches = chunk(userIds, USER_BATCH_SIZE);
    await Promise.all(
      batches.map(async (batchUserIds, index) => {
        const stepName = `memory:user-memory:hourly:trigger-users:${index}`;
        return context.run(stepName, () =>
          MemoryExtractionWorkflowService.triggerProcessUsers(
            buildWorkflowPayloadInput(
              normalizeMemoryExtractionPayload({
                baseUrl,
                mode: 'workflow',
                sources: [MemorySourceType.ChatTopic],
                userIds: batchUserIds,
              }),
            ),
            { extraHeaders: upstashWorkflowExtraHeaders },
          ),
        );
      }),
    );
  }

  if (nextCursor) {
    const stepName = 'memory:user-memory:hourly:schedule-next-page';
    await context.run(stepName, () =>
      MemoryExtractionWorkflowService.triggerHourly(
        {
          baseUrl,
          cursor: nextCursor,
          dryRun,
        },
        { extraHeaders: upstashWorkflowExtraHeaders },
      ),
    );
  }

  return {
    dryRun: !!dryRun,
    hasNextPage: !!nextCursor,
    processedUsers: userIds.length,
    scheduledBatches: dryRun ? 0 : chunk(userIds, USER_BATCH_SIZE).length,
  };
};

export const hourlyWorkflowOptions = {
  flowControl: {
    key: 'memory-user-memory.call-cron-hourly-analysis',
    parallelism: 1,
    ratePerSecond: 1,
  },
};
