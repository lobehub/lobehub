import type { Context } from 'hono';
import { z } from 'zod';

import { UserMemoryConsolidationModel } from '@/database/models/userMemory/consolidation';
import { getServerDB } from '@/database/server';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { MemoryExtractionWorkflowService } from '@/server/services/memory/userMemory/extract';

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('run'),
    baseUrl: z.string().url().optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
    userIds: z.array(z.string().min(1)).min(1),
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
      return c.json({ message: 'Consolidation run reverted.', ...result }, 200);
    }

    const baseUrl = params.baseUrl || webhook.baseUrl || new URL(c.req.url).origin;
    const results = await Promise.all(
      [...new Set(params.userIds)].map(async (userId) => {
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
      }),
    );

    return c.json({ message: 'Memory consolidation scheduled via workflow.', results }, 202);
  } catch (error) {
    console.error('[memory-consolidation] failed', error);
    return c.json({ error: (error as Error).message }, 500);
  }
};
