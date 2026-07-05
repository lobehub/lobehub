import { type WorkflowContext } from '@upstash/workflow';
import { z } from 'zod';

import { getServerDB } from '@/database/server';
import {
  buildUserPersonaJobInput,
  UserPersonaService,
} from '@/server/services/memory/userMemory/persona/service';

import { checkGuard } from './runGuard';

const WORKFLOW_PATH = 'api/workflows/memory-user-memory/pipelines/persona/update-writing';

const workflowPayloadSchema = z.object({
  userIds: z.array(z.string()).optional(),
});

export const personaUpdateHandler = async (context: WorkflowContext) => {
  // NOTICE: Return (never throw) on a guard match — a throw before the first step makes Upstash
  // re-enqueue the run, turning a "disable" guard into an infinite retry storm.
  const entryGuard = await checkGuard(context, WORKFLOW_PATH, {
    response: { processedUsers: 0 },
  });
  if (!entryGuard.result) return entryGuard.response;

  const parsePayloadStepName = 'memory:pipelines:persona:update-writing:parse-payload';
  const parsePayloadGuard = await checkGuard(context, WORKFLOW_PATH, {
    response: { processedUsers: 0 },
    stepName: parsePayloadStepName,
  });
  if (!parsePayloadGuard.result) return parsePayloadGuard.response;

  const payload = await context.run(parsePayloadStepName, () =>
    workflowPayloadSchema.parse(context.requestPayload || {}),
  );
  const db = await getServerDB();

  const userIds = Array.from(new Set(payload.userIds || [])).filter(Boolean);
  if (userIds.length === 0) {
    throw new Error('No user IDs provided for persona update.');
  }

  const service = new UserPersonaService(db);

  for (const userId of userIds) {
    const stepName = `memory:pipelines:persona:update-writing:users:${userId}`;
    const guard = await checkGuard(context, WORKFLOW_PATH, {
      response: { processedUsers: 0 },
      stepName,
    });
    if (!guard.result) return guard.response;

    await context.run(stepName, async () => {
      const jobInput = await buildUserPersonaJobInput(db, userId);
      const result = await service.composeWriting({ ...jobInput, userId });
      return {
        diffId: result.diff?.id,
        documentId: result.document.id,
        userId,
        version: result.document.version,
      };
    });
  }

  return {
    message: 'User persona processed via workflow.',
    processedUsers: userIds.length,
  };
};

// NOTICE: Serve-side flow control governs this workflow's own step-continuation messages so they
// carry a flow-control key instead of falling into the shared "$" (unbound) bucket, which floods
// when steps retry. `triggerPersonaUpdate` sets a per-user key for the *initial* delivery; this
// static global key bounds concurrent step execution across users. Parallelism is a conservative
// global cap.
export const personaUpdateWorkflowOptions = {
  flowControl: {
    key: 'memory-user-memory.pipelines.persona.update-write',
    parallelism: 4,
  },
};
