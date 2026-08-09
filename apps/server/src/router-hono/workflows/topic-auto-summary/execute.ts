import type { WorkflowContext } from '@upstash/workflow';

import { getServerDB } from '@/database/server';
import { TopicAutoSummaryService } from '@/server/services/topicAutoSummary';
import type { ExecuteTopicAutoSummaryPayload } from '@/server/workflows/topicAutoSummary';

export const executeTopicAutoSummary = async (
  context: WorkflowContext<ExecuteTopicAutoSummaryPayload>,
) => {
  const { force, topicId, userId, workspaceId } = context.requestPayload ?? {};
  if (!topicId || !userId) return { error: 'Missing topicId or userId', summarized: false };

  return context.run('topic-auto-summary:generate-and-save', async () => {
    const db = await getServerDB();
    return new TopicAutoSummaryService(db, userId, workspaceId).summarize(topicId, { force });
  });
};

export const executeTopicAutoSummaryOptions = {
  flowControl: { key: 'topic-auto-summary.execute', parallelism: 10, ratePerSecond: 5 },
};
