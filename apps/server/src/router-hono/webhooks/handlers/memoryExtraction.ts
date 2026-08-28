import type { Context } from 'hono';

import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import {
  buildWorkflowPayloadInput,
  MemoryExtractionExecutor,
  memoryExtractionPayloadSchema,
  MemoryExtractionWorkflowService,
  normalizeMemoryExtractionPayload,
} from '@/server/services/memory/userMemory/extract';

/**
 * Entry point for memory extraction: either schedules the Upstash workflow or
 * runs the extraction inline, depending on the payload `mode`.
 *
 * Header auth is applied by the `memoryWebhookAuth` middleware.
 */
export const memoryExtractionWebhook = async (c: Context) => {
  const { upstashWorkflowExtraHeaders } = parseMemoryExtractionConfig();

  try {
    const json = await c.req.json();
    const origin = new URL(c.req.url).origin;

    const payload = memoryExtractionPayloadSchema.parse({
      ...json,
      baseUrl: json.baseUrl || origin,
    });
    if (payload.fromDate && payload.toDate && payload.fromDate > payload.toDate) {
      return c.json({ error: '`fromDate` cannot be later than `toDate`' }, 400);
    }

    const params = normalizeMemoryExtractionPayload(payload, origin);
    if (params.mode === 'workflow') {
      const { workflowRunId } = await MemoryExtractionWorkflowService.triggerProcessUsers(
        buildWorkflowPayloadInput(params),
        { extraHeaders: upstashWorkflowExtraHeaders },
      );

      return c.json({ message: 'Memory extraction scheduled via workflow.', workflowRunId }, 202);
    }

    const executor = await MemoryExtractionExecutor.create();
    const result = await executor.runDirect(params);

    return c.json({ message: 'Memory extraction executed via webhook.', result }, 200);
  } catch (error) {
    console.error('[memory-extraction] failed', error);

    return c.json({ error: (error as Error).message }, 500);
  }
};
