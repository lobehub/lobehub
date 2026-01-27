import { serve } from '@upstash/workflow/nextjs';
import { z } from 'zod';

import { getServerDB } from '@/database/server';
import {
  UserPersonaService,
  buildUserPersonaJobInput,
} from '@/server/services/memory/userMemory/persona/service';

const workflowPayloadSchema = z.object({
  userId: z.string().optional(),
  userIds: z.array(z.string()).optional(),
});

export const { POST } = serve(async (context) => {
  const payload = workflowPayloadSchema.parse(context.requestPayload || {});
  const db = await getServerDB();

  const userIds = Array.from(
    new Set([...(payload.userIds || []), ...(payload.userId ? [payload.userId] : [])]),
  ).filter(Boolean);

  if (userIds.length === 0) {
    return { message: 'userId or userIds is required', processedUsers: 0 };
  }

  const service = new UserPersonaService(db);
  const results = [];

  for (const userId of userIds) {
    const context = await buildUserPersonaJobInput(db, userId);
    const result = await service.composeWriting({ ...context, userId });
    results.push({
      diffId: result.diff?.id,
      documentId: result.document.id,
      userId,
      version: result.document.version,
    });
  }

  return {
    message: 'User persona processed via workflow.',
    processedUsers: userIds.length,
    results,
  };
});
