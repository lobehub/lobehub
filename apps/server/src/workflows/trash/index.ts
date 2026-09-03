import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import { qstashClient } from '@/libs/qstash';
import type { TrashSweepCursor, TrashSweepOutcome } from '@/server/services/trash';
import { after } from '@/server/utils/scheduleAfterResponse';

export const TRASH_PURGE_WORKFLOW_PATH = '/api/workflows/trash/purge';
export const TRASH_PURGE_LOCAL_CONTINUATION_PATH = '/api/workflows/trash/purge/local';

export interface TrashPurgeWorkflowPayload {
  cursor?: { expiresAt: string; id: string };
  limit?: number;
  remainingBatches?: number;
}

const LOCAL_BATCH_SIZE = 25;
const LOCAL_BATCH_BUDGET = 8;
const MAX_BATCH_SIZE = 50;
const LOCAL_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const publishLocalTrashContinuation = async (payload: TrashPurgeWorkflowPayload) => {
  const secret = process.env.KEY_VAULTS_SECRET;
  if (!secret) throw new Error('KEY_VAULTS_SECRET is required for local trash purge continuation');

  const baseUrl = appEnv.INTERNAL_APP_URL || appEnv.APP_URL;
  const headers: Record<string, string> = {
    'authorization': `Bearer ${secret}`,
    'content-type': 'application/json',
  };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }

  const response = await fetch(new URL(TRASH_PURGE_LOCAL_CONTINUATION_PATH, baseUrl), {
    body: JSON.stringify(payload),
    headers,
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Local trash purge continuation returned ${response.status}`);
  }
};

interface LocalTrashPurgeDependencies {
  getDb?: () => Promise<LobeChatDatabase>;
  sweepExpired?: (
    db: LobeChatDatabase,
    options: { cursor?: TrashSweepCursor; limit: number },
  ) => Promise<TrashSweepOutcome>;
}

/** Run a bounded retention burst without requiring an external queue. */
export const runLocalTrashPurge = async (
  payload: TrashPurgeWorkflowPayload = {},
  dependencies: LocalTrashPurgeDependencies = {},
) => {
  const getDb =
    dependencies.getDb ??
    (async () => {
      const { getServerDB } = await import('@/database/server');
      return getServerDB();
    });
  const sweepExpired =
    dependencies.sweepExpired ??
    (async (db, options) => {
      const { TrashService } = await import('@/server/services/trash');
      return TrashService.sweepExpired(db, options);
    });
  const db = await getDb();
  const limit = Math.min(Math.max(payload.limit ?? LOCAL_BATCH_SIZE, 1), MAX_BATCH_SIZE);
  const batchBudget = Math.min(
    Math.max(payload.remainingBatches ?? LOCAL_BATCH_BUDGET, 1),
    LOCAL_BATCH_BUDGET,
  );
  let cursor = payload.cursor;
  let batches = 0;

  while (batches < batchBudget) {
    const outcome = await sweepExpired(db, { cursor, limit });
    batches += 1;
    if (outcome.scanned < limit || !outcome.nextCursor) return { batches, cursor: undefined };
    cursor = outcome.nextCursor;
  }

  return { batches, cursor };
};

const runAndContinueLocalTrashPurge = async (payload: TrashPurgeWorkflowPayload = {}) => {
  const outcome = await runLocalTrashPurge(payload);
  if (!outcome.cursor) return;

  await publishLocalTrashContinuation({ ...payload, cursor: outcome.cursor });
};

/** Queue one bounded retention-sweep request, with an in-process fallback. */
export const triggerTrashPurge = async (
  payload: TrashPurgeWorkflowPayload = {},
  options?: { delay?: number },
) => {
  if (!process.env.QSTASH_TOKEN) {
    after(async () => {
      await runAndContinueLocalTrashPurge(payload);
    });
    return true;
  }

  const baseUrl = appEnv.INTERNAL_APP_URL || appEnv.APP_URL;
  await qstashClient.publishJSON({
    body: payload,
    ...(options?.delay === undefined ? {} : { delay: options.delay }),
    url: new URL(TRASH_PURGE_WORKFLOW_PATH, baseUrl).toString(),
  });
  return true;
};

type TrashPurgeSchedulerGlobal = typeof globalThis & {
  __lobeTrashPurgeInterval?: ReturnType<typeof setInterval>;
};

/** Start hourly retention sweeps on persistent, self-hosted Node processes. */
export const startLocalTrashPurgeSchedule = () => {
  if (process.env.QSTASH_TOKEN || !process.env.DATABASE_URL) return;
  const schedulerGlobal = globalThis as TrashPurgeSchedulerGlobal;
  if (schedulerGlobal.__lobeTrashPurgeInterval) return;

  const sweep = () => {
    void runAndContinueLocalTrashPurge().catch((error) => {
      console.error('[trash/purge] Local retention sweep failed:', error);
    });
  };
  sweep();
  schedulerGlobal.__lobeTrashPurgeInterval = setInterval(sweep, LOCAL_SWEEP_INTERVAL_MS);
  schedulerGlobal.__lobeTrashPurgeInterval.unref?.();
};
