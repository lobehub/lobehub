import debug from 'debug';

import { DeployResumeQueueModel } from '@/database/models/deployResumeQueue';
import type { LobeChatDatabase } from '@/database/type';

import { isDeployResumeEnabled } from './config';
import { isPermanentResumeError, resumeDeployRow } from './module';

export { isDeployChatResumeEnabled, isDeployResumeEnabled } from './config';

const log = debug('deploy-resume');

/** One boot replays a bounded batch; a bigger backlog rolls into the next restart. */
const MAX_PER_BOOT = 20;
/** Attempts per row before it is parked as `failed`. */
const MAX_ATTEMPTS = 3;
const CONCURRENCY = 5;
/** Backoff between attempts of the same row — a busy topic usually clears fast. */
const RETRY_DELAY_MS = 5000;
/** Older rows belong to conversations people moved past; never replay them. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Rows this process is draining. The queue's own `claim` is what actually makes
 * a dispatch exclusive across processes; this set only keeps one process from
 * starting the same row twice.
 */
const running = new Set<string>();

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const drainRow = async (db: LobeChatDatabase, id: string) => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // Claimed here, so two containers booting at once dispatch a conversation
    // exactly once: the loser gets `undefined` and walks away.
    const row = await DeployResumeQueueModel.claim(db, id);
    if (!row) return;

    try {
      const outcome = await resumeDeployRow(db, row);
      await DeployResumeQueueModel.finish(db, id, outcome.status, {
        error: outcome.reason ?? null,
      });
      log('[%s] %s%s', id, outcome.status, outcome.reason ? `: ${outcome.reason}` : '');
      return;
    } catch (error) {
      if (isPermanentResumeError(error)) {
        await DeployResumeQueueModel.finish(db, id, 'skipped', { error: errorMessage(error) });
        return;
      }

      if (attempt < MAX_ATTEMPTS) {
        await DeployResumeQueueModel.release(db, id, errorMessage(error));
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      console.error('[deploy-resume] %s failed after %d attempts: %O', id, attempt, error);
      await DeployResumeQueueModel.finish(db, id, 'failed', { error: errorMessage(error) });
      return;
    }
  }
};

/**
 * Resume one queued conversation. Never throws: a resume that cannot start must
 * not take the server's boot path with it.
 */
export const startDeployResume = async (db: LobeChatDatabase, id: string): Promise<void> => {
  if (running.has(id)) return;
  running.add(id);

  try {
    await drainRow(db, id);
  } catch (error) {
    console.error('[deploy-resume] %s could not be resumed: %O', id, error);
  } finally {
    running.delete(id);
  }
};

/**
 * Replay the conversations the deploy script queued before it stopped the old
 * container.
 *
 * Called once at boot from `instrumentation.ts`. It drops rows older than the
 * staleness window, then resumes up to {@link MAX_PER_BOOT} pending rows a few
 * at a time, and swallows everything — including a missing queue table — so a
 * deploy can never leave the server unable to start.
 *
 * @returns how many rows this boot considered.
 */
export const resumePendingDeployResumes = async (db: LobeChatDatabase): Promise<number> => {
  if (!isDeployResumeEnabled()) {
    log('RESUME_AFTER_DEPLOY=0, skipping deploy resume');
    return 0;
  }

  try {
    const stale = await DeployResumeQueueModel.skipStale(db, new Date(Date.now() - STALE_AFTER_MS));
    if (stale > 0) log('%d stale resume rows were dropped', stale);

    const rows = await DeployResumeQueueModel.listPending(db, { limit: MAX_PER_BOOT });
    if (rows.length === 0) return 0;

    log('resuming %d conversations interrupted by the last deploy', rows.length);

    for (let index = 0; index < rows.length; index += CONCURRENCY) {
      await Promise.all(
        rows.slice(index, index + CONCURRENCY).map((row) => startDeployResume(db, row.id)),
      );
    }

    return rows.length;
  } catch (error) {
    console.error('[deploy-resume] failed to resume interrupted conversations: %O', error);
    return 0;
  }
};
