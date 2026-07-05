import { type WorkflowContext } from '@upstash/workflow';
import { z } from 'zod';

import { getServerDB } from '@/database/server';
import {
  buildUserPersonaJobInput,
  UserPersonaService,
} from '@/server/services/memory/userMemory/persona/service';

import { resolveMemoryWorkflowRunGuard } from './runGuard';

const WORKFLOW_PATH = 'api/workflows/memory-user-memory/pipelines/persona/update-writing';

const workflowPayloadSchema = z.object({
  userIds: z.array(z.string()).optional(),
});

export const personaUpdateHandler = async (context: WorkflowContext) => {
  // NOTICE: Return (never throw) on a guard match — a throw before the first step makes Upstash
  // re-enqueue the run, turning a "disable" guard into an infinite retry storm.
  const guardBlock = await resolveMemoryWorkflowRunGuard(context, WORKFLOW_PATH);
  if (guardBlock) {
    return {
      message: `Memory workflow disabled by run guard (${guardBlock.reason ?? guardBlock.scope}); skipping.`,
      processedUsers: 0,
      skipped: true,
    };
  }

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
        const jobInput = await buildUserPersonaJobInput(db, userId);
        const result = await service.composeWriting({ ...jobInput, userId });
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
};
