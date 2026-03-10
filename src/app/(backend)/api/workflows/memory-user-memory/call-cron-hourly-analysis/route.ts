import { MemorySourceType } from '@lobechat/types';
import { Client } from '@upstash/qstash';
import { serve } from '@upstash/workflow/nextjs';
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

const USER_PAGE_SIZE = 200;
const USER_BATCH_SIZE = 20;

const { webhook, upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();

const resolveBaseUrl = () => webhook.baseUrl || appEnv.INTERNAL_APP_URL || appEnv.APP_URL;

export const { POST } = serve<MemoryExtractionHourlyWorkflowPayload>(
  async (context) => {
    const { cursor, dryRun } = context.requestPayload || {};

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
    const userBatch = await context.run(
      `memory:user-memory:hourly:list-users:${parsedCursor?.id || 'root'}`,
      () => executor.getUsersForHourlyExtraction(USER_PAGE_SIZE, parsedCursor),
    );

    const userIds = userBatch.ids;
    if (userIds.length === 0) {
      return { message: 'No eligible users for hourly memory extraction.', processedUsers: 0 };
    }

    const nextCursor = userBatch.cursor
      ? {
          createdAt: userBatch.cursor.createdAt.toISOString(),
          id: userBatch.cursor.id,
        }
      : undefined;

    if (!dryRun) {
      const batches = chunk(userIds, USER_BATCH_SIZE);
      await Promise.all(
        batches.map((batchUserIds, index) =>
          context.run(`memory:user-memory:hourly:trigger-users:${index}`, () =>
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
          ),
        ),
      );
    }

    if (nextCursor) {
      await context.run('memory:user-memory:hourly:schedule-next-page', () =>
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
  },
  {
    flowControl: {
      key: 'memory-user-memory.call-cron-hourly-analysis',
      parallelism: 1,
      ratePerSecond: 1,
    },
    // NOTICE(@nekomeowww): Here as scenarios like Vercel Deployment Protection,
    // intermediate context.run(...) won't offer customizable headers like context.trigger(...) / client.trigger(...)
    // for passing additional headers, we have to provide a custom QStash client with the required headers here.
    //
    // Refer to the doc for more details:
    // https://upstash.com/docs/workflow/troubleshooting/vercel#step-2-pass-header-when-triggering
    qstashClient: new Client({
      headers: {
        ...upstashWorkflowExtraHeaders,
      },
      token: process.env.QSTASH_TOKEN!,
    }),
  },
);
