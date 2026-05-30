import debug from 'debug';

import { getServerDB } from '@/database/server';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';

import { type ExtractorDependencies, defaultExtractorDeps } from './dependencies';
import { type MemoryExtractionPayloadInput, MemoryExtractionExecutor } from './extract';
import { extractTopicInProcess } from './extractTopicInProcess';
import { retryWithBackoff } from './retryWithBackoff';
import { isTaskCancelled, markTaskStatus, updateTaskProgress } from './taskStatusManager';
import { processItemsConcurrent } from './topicBatching';

const log = debug('lobe-server:memory:user-memory:in-process');

export { extractTopicInProcess } from './extractTopicInProcess';
export { CEPA_LAYERS, IDENTITY_LAYERS } from './extractTopicInProcess';
export { isTaskCancelled, markTaskStatus, updateTaskProgress } from './taskStatusManager';

const TOPIC_PAGE_SIZE = 50;
const TOPIC_BATCH_SIZE = 4;
const BATCH_DELAY_MS = 2000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;

const getTopicConcurrency = (): number => {
  const config = parseMemoryExtractionConfig();
  return config.workflowParallelism ?? 5;
};

interface TopicHandlerContext {
  cancelled: boolean;
  db: any;
  executor: MemoryExtractionExecutor;
  from?: Date;
  payload: MemoryExtractionPayloadInput;
  to?: Date;
  userId: string;
}

async function processTopicWithRetry(
  topicId: string,
  ctx: TopicHandlerContext,
): Promise<'ok' | 'cancelled' | 'failed'> {
  if (ctx.cancelled) return 'cancelled';

  try {
    const { cancelled } = await retryWithBackoff(
      () =>
        extractTopicInProcess({
          asyncTaskId: ctx.payload.asyncTaskId,
          checkCancellation: async () => {
            if (!ctx.payload.asyncTaskId) return false;
            const cancelled = await isTaskCancelled(ctx.db, ctx.userId, ctx.payload.asyncTaskId);
            if (cancelled) ctx.cancelled = true;
            return cancelled;
          },
          executor: ctx.executor,
          forceAll: ctx.payload.forceAll ?? false,
          forceTopics: ctx.payload.forceTopics ?? false,
          from: ctx.from,
          to: ctx.to,
          topicId,
          userId: ctx.userId,
          userInitiated: ctx.payload.userInitiated ?? true,
        }),
      { baseDelayMs: RETRY_BASE_DELAY_MS, maxRetries: MAX_RETRIES },
    );

    if (cancelled) return 'cancelled';
    return 'ok';
  } catch (error: any) {
    log('topic %s failed after retries: %s', topicId, error?.message || error);
    return 'failed';
  }
}

async function processBatch(
  topicIds: string[],
  ctx: TopicHandlerContext,
  concurrency: number,
): Promise<{ cancelled: boolean; failed: number; processed: number }> {
  let processed = 0;
  let failed = 0;

  const results = await processItemsConcurrent(
    topicIds,
    async (topicId) => {
      if (ctx.cancelled) return;

      const result = await processTopicWithRetry(topicId, ctx);
      if (result === 'ok') {
        processed++;
      } else if (result === 'failed') {
        failed++;
      }

      if (ctx.payload.asyncTaskId && ctx.payload.userInitiated && result !== 'cancelled') {
        try {
          await updateTaskProgress(ctx.db, ctx.userId, ctx.payload.asyncTaskId);
        } catch (progressError) {
          log('failed to update progress: %s', progressError);
        }
      }
    },
    { concurrency },
  );

  for (const r of results) {
    if (!r.success && r.item) {
      log('topic %s handler error: %O', r.item, r.error);
    }
  }

  return { cancelled: ctx.cancelled, failed, processed };
}

export async function processUsersInProcess(
  payload: MemoryExtractionPayloadInput,
  deps?: ExtractorDependencies,
): Promise<void> {
  const getDB = deps?.getServerDB ?? defaultExtractorDeps.getServerDB;
  const createExec = deps?.createExecutor ?? defaultExtractorDeps.createExecutor;

  try {
    const executor = await createExec();
    const db = await getDB();
    const concurrency = getTopicConcurrency();

    const userIds =
      payload.userIds && payload.userIds.length > 0
        ? payload.userIds
        : (await executor.getUsers(50)).ids;

    for (const userId of userIds) {
      let totalProcessed = 0;
      let totalFailed = 0;
      let cursor = undefined;
      let cancelled = false;

      const ctx: TopicHandlerContext = {
        cancelled: false,
        db,
        executor,
        from: payload.fromDate ? new Date(payload.fromDate) : undefined,
        payload,
        to: payload.toDate ? new Date(payload.toDate) : undefined,
        userId,
      };

      do {
        const topics = await executor.getTopicsForUser(
          {
            cursor,
            forceAll: true,
            forceTopics: true,
            from: ctx.from,
            to: ctx.to,
            userId,
          },
          TOPIC_PAGE_SIZE,
        );

        if (topics.ids.length === 0) break;

        for (let batchStart = 0; batchStart < topics.ids.length; batchStart += TOPIC_BATCH_SIZE) {
          if (ctx.cancelled) break;

          const batch = topics.ids.slice(batchStart, batchStart + TOPIC_BATCH_SIZE);
          const result = await processBatch(batch, ctx, concurrency);

          totalProcessed += result.processed;
          totalFailed += result.failed;
          cancelled = result.cancelled;

          if (!cancelled && batchStart + TOPIC_BATCH_SIZE < topics.ids.length) {
            await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
          }
        }

        cursor = topics.cursor;
      } while (cursor && !cancelled);

      log('completed user %s: %O', userId, {
        processed: totalProcessed,
        failed: totalFailed,
        total: totalProcessed + totalFailed,
      });
    }

    if (payload.asyncTaskId) {
      try {
        await markTaskStatus(db, payload.userIds?.[0] || '', payload.asyncTaskId, 'success');
      } catch (taskError) {
        log('failed to mark task as completed: %s', taskError);
      }
    }
  } catch (error: any) {
    log('memory extraction failed: %s', error?.message || error);

    if (payload.asyncTaskId) {
      try {
        const db = await getDB();
        await markTaskStatus(db, payload.userIds?.[0] || '', payload.asyncTaskId, 'error', error);
      } catch (taskError) {
        log('failed to mark task as failed: %s', taskError);
      }
    }
  }
}

export async function processTopicsInProcess(
  userId: string,
  payload: MemoryExtractionPayloadInput,
  triggerPersonaUpdate: () => Promise<any>,
  deps?: ExtractorDependencies,
): Promise<void> {
  const getDB = deps?.getServerDB ?? defaultExtractorDeps.getServerDB;
  const createExec = deps?.createExecutor ?? defaultExtractorDeps.createExecutor;

  try {
    const executor = await createExec();
    const db = await getDB();
    const concurrency = getTopicConcurrency();

    const ctx: TopicHandlerContext = {
      cancelled: false,
      db,
      executor,
      from: payload.fromDate ? new Date(payload.fromDate) : undefined,
      payload,
      to: payload.toDate ? new Date(payload.toDate) : undefined,
      userId,
    };

    const topicIds = payload.topicIds || [];
    const result = await processBatch(topicIds, ctx, concurrency);

    log('processTopics completed for user %s: %O', userId, {
      processed: result.processed,
      failed: result.failed,
    });

    try {
      await triggerPersonaUpdate();
    } catch (personaError) {
      log('failed to trigger persona update: %s', personaError);
    }
  } catch (error: any) {
    log('processTopics failed: %s', error?.message || error);
  }
}
