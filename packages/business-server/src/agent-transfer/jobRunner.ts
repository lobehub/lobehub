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

/**
 * Global drain-concurrency bound. A single call site can hand this runner a
 * burst of jobs — one deferred group-history remap per group, or every
 * pending job at boot — and each drain is a loop of index-heavy message
 * UPDATE transactions; running them all at once would saturate PostgreSQL.
 * Jobs beyond the bound wait in FIFO order and start as slots free up.
 */
const MAX_CONCURRENT_DRAINS = 3;

/** Every job this runner owns right now: actively draining OR queued. */
const running = new Set<string>();
const waiting: { db: LobeChatDatabase; jobId: string }[] = [];
let activeDrains = 0;

const drainOnce = async (db: LobeChatDatabase, jobId: string): Promise<boolean> => {
  try {
    // Type-dispatching drain: the same runner serves transfer and copy jobs.
    await drainAgentHistoryJob(db, jobId);
    return true;
  } catch (error) {
    // Keep the job pending and retry forever — the job row stays visible as
    // "migrating" instead of silently dying, per the transfer design.
    console.error(`[agent-transfer] drain of ${jobId} failed, retrying:`, error);
    return false;
  }
};

const pumpDrains = (): void => {
  while (activeDrains < MAX_CONCURRENT_DRAINS && waiting.length > 0) {
    const next = waiting.shift()!;
    activeDrains += 1;
    void drainOnce(next.db, next.jobId).then((done) => {
      activeDrains -= 1;
      if (done) {
        running.delete(next.jobId);
      } else {
        // Yield the slot between retries: the job stays in `running` (so
        // repeated start calls stay deduped) but re-queues after a delay,
        // letting healthy jobs drain instead of a persistently failing one
        // pinning a slot forever.
        setTimeout(() => {
          waiting.push(next);
          pumpDrains();
        }, RETRY_DELAY_MS);
      }
      pumpDrains();
    });
  }
};

export const startAgentTransferJob = (
  db: LobeChatDatabase,
  jobId: string,
  options: {
    /**
     * Jump the FIFO: a user is waiting on this job (topic prioritization),
     * so a queued instance moves to the front instead of sitting behind a
     * boot-recovery backlog of full migrations. An actively draining job is
     * left alone; duplicate suppression holds either way.
     */
    promote?: boolean;
  } = {},
): void => {
  if (running.has(jobId)) {
    if (options.promote) {
      const queuedIndex = waiting.findIndex((entry) => entry.jobId === jobId);
      if (queuedIndex > 0) waiting.unshift(...waiting.splice(queuedIndex, 1));
    }
    return;
  }
  running.add(jobId);
  if (options.promote) waiting.unshift({ db, jobId });
  else waiting.push({ db, jobId });
  pumpDrains();
};

export const prioritizeAgentTransferTopic = async (
  db: LobeChatDatabase,
  topicId: string,
): Promise<boolean> => {
  const flagged = await AgentTransferJobModel.prioritizeTopic(db, topicId);
  if (!flagged) return false;

  const pending = await AgentTransferJobModel.findPendingJobForTopic(db, topicId);
  if (pending) startAgentTransferJob(db, pending.jobId, { promote: true });
  return true;
};

/** Re-arm jobs left over from a restart. Callers may invoke this at boot. */
export const resumePendingAgentTransferJobs = async (db: LobeChatDatabase): Promise<void> => {
  const jobIds = await AgentTransferJobModel.listPendingJobIds(db);
  for (const jobId of jobIds) startAgentTransferJob(db, jobId);
};
