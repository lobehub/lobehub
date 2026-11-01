import { eq } from 'drizzle-orm';

import { agentHistoryJobs } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { AgentCopyJobModel } from './agentCopyJob';
import { AgentTransferJobModel } from './agentTransferJob';

/**
 * Type-dispatching entry over the `agent_history_jobs` queue: routes one drain
 * unit to the model matching the job's `type`. Job drivers (in-process runner,
 * workflow steps, resume crons) call these so a single drain pipeline serves
 * every job kind.
 */
export const processNextAgentHistoryJobTopic = async (
  db: LobeChatDatabase,
  jobId: string,
): Promise<{ done: boolean; topicId?: string }> => {
  const [job] = await db
    .select({ type: agentHistoryJobs.type })
    .from(agentHistoryJobs)
    .where(eq(agentHistoryJobs.id, jobId))
    .limit(1);
  if (!job) return { done: true };
  return job.type === 'copy'
    ? AgentCopyJobModel.processNextTopic(db, jobId)
    : AgentTransferJobModel.processNextTopic(db, jobId);
};

/** Run any history job to completion, whatever its type. */
export const drainAgentHistoryJob = async (db: LobeChatDatabase, jobId: string): Promise<void> => {
  while (true) {
    const { done } = await processNextAgentHistoryJobTopic(db, jobId);
    if (done) return;
  }
};
