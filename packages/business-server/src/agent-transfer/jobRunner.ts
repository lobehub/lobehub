import {
  AgentTransferJobModel,
  drainAgentHistoryJob,
  type LobeChatDatabase,
} from '@lobechat/database';

/**
 * Default in-process driver for agent-transfer backfill jobs.
 *
 * Business slot contract (cloud may override this module with a durable-queue
 * driver; the call sites depend only on these two functions):
 *
 * - `startAgentTransferJob(db, jobId)` — fire-and-forget: begin (or resume)
 *   draining the job. MUST be safe to call repeatedly for the same job.
 * - `prioritizeAgentTransferTopic(db, topicId)` — the user opened a topic that
 *   is still pending; flag it to be drained next and make sure its job is
 *   running. Returns false when the topic is not pending (already migrated).
 *
 * The default implementation drains inside the current process, which suits a
 * long-running self-hosted Node server. A crash mid-drain is safe: the job's
 * queue rows survive, and the next `startAgentTransferJob` call (a retry, a
 * prioritize, or the periodic `resumePendingAgentTransferJobs`) resumes where
 * it stopped.
 */

const RETRY_DELAY_MS = 5000;

const running = new Set<string>();

const drainWithRetry = async (db: LobeChatDatabase, jobId: string): Promise<void> => {
  try {
    // Type-dispatching drain: the same runner serves transfer and copy jobs.
    await drainAgentHistoryJob(db, jobId);
  } catch (error) {
    // Keep the job pending and retry forever — the job row stays visible as
    // "migrating" instead of silently dying, per the transfer design.
    console.error(`[agent-transfer] drain of ${jobId} failed, retrying:`, error);
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return drainWithRetry(db, jobId);
  }
};

export const startAgentTransferJob = (db: LobeChatDatabase, jobId: string): void => {
  if (running.has(jobId)) return;
  running.add(jobId);

  void drainWithRetry(db, jobId).finally(() => {
    running.delete(jobId);
  });
};

export const prioritizeAgentTransferTopic = async (
  db: LobeChatDatabase,
  topicId: string,
): Promise<boolean> => {
  const flagged = await AgentTransferJobModel.prioritizeTopic(db, topicId);
  if (!flagged) return false;

  const pending = await AgentTransferJobModel.findPendingJobForTopic(db, topicId);
  if (pending) startAgentTransferJob(db, pending.jobId);
  return true;
};

/** Re-arm jobs left over from a restart. Callers may invoke this at boot. */
export const resumePendingAgentTransferJobs = async (db: LobeChatDatabase): Promise<void> => {
  const jobIds = await AgentTransferJobModel.listPendingJobIds(db);
  for (const jobId of jobIds) startAgentTransferJob(db, jobId);
};
