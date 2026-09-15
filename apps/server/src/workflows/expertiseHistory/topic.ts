import type { WorkflowContext } from '@upstash/workflow';

import { getServerDB } from '@/database/server';
import { ExpertiseIngestionService } from '@/server/services/expertise/ingestion';
import { runStep } from '@/server/workflows/step';

import type { ExpertiseHistoryTopicWorkflowPayload } from './types';

export const runExpertiseHistoryTopicWorkflow = async (
  context: WorkflowContext<ExpertiseHistoryTopicWorkflowPayload>,
) => {
  const payload = context.requestPayload;
  return runStep(context, `expertise-history:topic:${payload.topicId}`, async () => {
    const db = await getServerDB();
    return new ExpertiseIngestionService(
      db,
      payload.userId,
      payload.workspaceId,
    ).ingestHistoricalTopic(payload.agentId, payload.topicId);
  });
};
