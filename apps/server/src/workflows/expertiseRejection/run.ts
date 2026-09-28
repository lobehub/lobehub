import type { WorkflowContext } from '@upstash/workflow';

import { getServerDB } from '@/database/server';
import { ExpertiseIngestionService } from '@/server/services/expertise/ingestion';
import { runStep } from '@/server/workflows/step';

import type { ExpertiseRejectionWorkflowPayload } from './types';

export const runExpertiseRejectionWorkflow = async (
  context: WorkflowContext<ExpertiseRejectionWorkflowPayload>,
) => {
  const payload = context.requestPayload;
  return runStep(context, `expertise-rejection:run:${payload.verifyRunId}`, async () => {
    const db = await getServerDB();
    return new ExpertiseIngestionService(
      db,
      payload.userId,
      payload.workspaceId,
    ).ingestAcceptanceRound({
      acceptanceId: payload.acceptanceId,
      verifyRunId: payload.verifyRunId,
    });
  });
};
