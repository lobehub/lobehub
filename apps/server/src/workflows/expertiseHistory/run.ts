import type { WorkflowContext } from '@upstash/workflow';

import { getServerDB } from '@/database/server';
import { ExpertiseIngestionService } from '@/server/services/expertise/ingestion';
import { runStep } from '@/server/workflows/step';

import type { ExpertiseHistoryWorkflowPayload } from './types';

export const runExpertiseHistoryWorkflow = async (
  context: WorkflowContext<ExpertiseHistoryWorkflowPayload>,
) => {
  const payload = context.requestPayload;
  const topics = await runStep(context, 'expertise-history:list-topics', async () => {
    const db = await getServerDB();
    return new ExpertiseIngestionService(
      db,
      payload.userId,
      payload.workspaceId,
    ).listHistoricalTopics(payload.agentId);
  });

  let ingested = 0;
  for (const topic of topics) {
    const result = await runStep(context, `expertise-history:topic:${topic.topicId}`, async () => {
      const db = await getServerDB();
      return new ExpertiseIngestionService(
        db,
        payload.userId,
        payload.workspaceId,
      ).ingestHistoricalTopic(payload.agentId, topic.topicId);
    });
    ingested += result.ingested;
  }

  return { ingested, scanned: topics.length };
};
