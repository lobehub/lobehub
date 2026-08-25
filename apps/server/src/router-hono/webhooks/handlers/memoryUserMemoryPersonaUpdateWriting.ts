import type { Context } from 'hono';
import { z } from 'zod';

import { getServerDB } from '@/database/server';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { MemoryExtractionWorkflowService } from '@/server/services/memory/userMemory/extract';
import {
  buildUserPersonaJobInput,
  UserPersonaService,
} from '@/server/services/memory/userMemory/persona/service';

const userPersonaWebhookSchema = z.object({
  baseUrl: z.string().url().optional(),
  mode: z.enum(['workflow', 'direct']).optional(),
  userId: z.string().optional(),
  userIds: z.array(z.string()).optional(),
});

type UserPersonaWebhookPayload = z.infer<typeof userPersonaWebhookSchema>;

const normalizeUserPersonaPayload = (
  payload: UserPersonaWebhookPayload,
  fallbackBaseUrl?: string,
) => {
  const parsed = userPersonaWebhookSchema.parse(payload);
  const baseUrl = parsed.baseUrl || fallbackBaseUrl;

  if (!baseUrl) throw new Error('Missing baseUrl for workflow trigger');

  return {
    baseUrl,
    mode: parsed.mode ?? 'workflow',
    userIds: Array.from(
      new Set([...(parsed.userIds || []), ...(parsed.userId ? [parsed.userId] : [])]),
    ).filter(Boolean),
  } as const;
};

/**
 * Regenerates the user persona writing profile, either via workflow fan-out or
 * inline. Header auth is applied by the `memoryWebhookAuth` middleware.
 */
export const memoryUserMemoryPersonaUpdateWriting = async (c: Context) => {
  const { upstashWorkflowExtraHeaders, webhook } = parseMemoryExtractionConfig();

  try {
    const json = await c.req.json();
    const origin = new URL(c.req.url).origin;
    const params = normalizeUserPersonaPayload(json, webhook.baseUrl || origin);

    if (params.userIds.length === 0) {
      return c.json({ error: 'userId or userIds is required' }, 400);
    }

    if (params.mode === 'workflow') {
      const results = await Promise.all(
        params.userIds.map(async (userId) => {
          const { workflowRunId } = await MemoryExtractionWorkflowService.triggerPersonaUpdate(
            userId,
            params.baseUrl,
            { extraHeaders: upstashWorkflowExtraHeaders },
          );

          return { userId, workflowRunId };
        }),
      );

      return c.json({ message: 'User persona update scheduled via workflow.', results }, 202);
    }

    const db = await getServerDB();

    const service = new UserPersonaService(db);
    const results = [];

    for (const userId of params.userIds) {
      const context = await buildUserPersonaJobInput(db, userId);
      const result = await service.composeWriting({ ...context, userId });
      results.push({ userId, ...result });
    }

    return c.json({ message: 'User persona generated via webhook.', results }, 200);
  } catch (error) {
    console.error('[user-persona] failed', error);

    return c.json({ error: (error as Error).message }, 500);
  }
};
