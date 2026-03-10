import { NextResponse } from 'next/server';
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

export const POST = async (req: Request) => {
  const { upstashWorkflowExtraHeaders, webhook } = parseMemoryExtractionConfig();

  if (webhook.headers && Object.keys(webhook.headers).length > 0) {
    for (const [key, value] of Object.entries(webhook.headers)) {
      const headerValue = req.headers.get(key);
      if (headerValue !== value) {
        return NextResponse.json(
          { error: `Unauthorized: Missing or invalid header '${key}'` },
          { status: 403 },
        );
      }
    }
  }

  try {
    const json = await req.json();
    const origin = new URL(req.url).origin;
    const params = normalizeUserPersonaPayload(json, webhook.baseUrl || origin);

    if (params.userIds.length === 0) {
      return NextResponse.json({ error: 'userId or userIds is required' }, { status: 400 });
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

      return NextResponse.json(
        { message: 'User persona update scheduled via workflow.', results },
        { status: 202 },
      );
    }

    const db = await getServerDB();

    const service = new UserPersonaService(db);
    const results = [];

    for (const userId of params.userIds) {
      const context = await buildUserPersonaJobInput(db, userId);
      const result = await service.composeWriting({ ...context, userId });
      results.push({ userId, ...result });
    }

    return NextResponse.json(
      { message: 'User persona generated via webhook.', results },
      { status: 200 },
    );
  } catch (error) {
    console.error('[user-persona] failed', error);

    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
};
