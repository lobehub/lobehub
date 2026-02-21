import { serve } from '@upstash/workflow/nextjs';
import { z } from 'zod';

import { getServerDB } from '@/database/server';
import {
  buildUserPersonaJobInput,
  UserPersonaService,
} from '@/server/services/memory/userMemory/persona/service';

const workflowPayloadSchema = z.object({
  userIds: z.array(z.string()).optional(),
});

export const { POST } = serve(async (context) => {
  const payload = await context.run('memory:pipelines:persona:update-writing:parse-payload', () =>
    workflowPayloadSchema.parse(context.requestPayload || {}),
  );
  const db = await getServerDB();

  const userIds = Array.from(new Set(payload.userIds || [])).filter(Boolean);
  if (userIds.length === 0) {
    throw new Error('No user IDs provided for persona update.');
  }

  const service = new UserPersonaService(db);

  await Promise.all(
    userIds.map(async (userId) =>
      context.run(`memory:pipelines:persona:update-writing:users:${userId}`, async () => {
        const context = await buildUserPersonaJobInput(db, userId);
        const result = await service.composeWriting({ ...context, userId });
        return {
          diffId: result.diff?.id,
          documentId: result.document.id,
          userId,
          version: result.document.version,
        };
      }),
    ),
  );

  return {
    message: 'User persona processed via workflow.',
    processedUsers: userIds.length,
  };
});
