import type { Context } from 'hono';
import pMap from 'p-map';
import { z } from 'zod';

import { UserMemoryConsolidationModel } from '@/database/models/userMemory/consolidation';
import { getServerDB } from '@/database/server';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { MemoryExtractionWorkflowService } from '@/server/services/memory/userMemory/extract';

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('run'),
    model: z.string().optional(),
    provider: z.string().optional(),
    userIds: z.array(z.string().min(1)).min(1).max(100),
  }),
  z.object({
    action: z.literal('revert'),
    runId: z.string().min(1),
    userId: z.string().min(1),
  }),
]);

/**
 * Starts a memory consolidation run per user (`action: run`), or undoes one run
 * (`action: revert`). Header auth is applied by the `memoryWebhookAuth` middleware.
 */
export const memoryUserMemoryConsolidation = async (c: Context) => {
  const { upstashWorkflowExtraHeaders, webhook } = parseMemoryExtractionConfig();

  try {
    const params = schema.parse(await c.req.json());

    if (params.action === 'revert') {
      const db = await getServerDB();
      const result = await new UserMemoryConsolidationModel(db, params.userId).revertRun(
        params.runId,
      );
      if (result.blockedBy)
        return c.json(
          { message: 'Later runs extended this run; revert them first.', ...result },
          409,
        );
      return c.json({ message: 'Consolidation run reverted.', ...result }, 200);
    }

    // The workflow destination comes from admin config or this request's origin, never the body.
    const baseUrl = webhook.baseUrl || new URL(c.req.url).origin;
    const results = await pMap(
      [...new Set(params.userIds)],
      async (userId) => {
        const { workflowRunId } = await MemoryExtractionWorkflowService.triggerConsolidation(
          userId,
          baseUrl,
          {
            extraHeaders: upstashWorkflowExtraHeaders,
            model: params.model,
            provider: params.provider,
          },
        );
        return { userId, workflowRunId };
      },
      { concurrency: 5 },
    );

    return c.json({ message: 'Memory consolidation scheduled via workflow.', results }, 202);
  } catch (error) {
    console.error('[memory-consolidation] failed', error);
    return c.json({ error: (error as Error).message }, 500);
  }
};
