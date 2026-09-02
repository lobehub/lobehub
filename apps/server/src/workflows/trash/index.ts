import { appEnv } from '@/envs/app';
import { qstashClient } from '@/libs/qstash';

export const TRASH_PURGE_WORKFLOW_PATH = '/api/workflows/trash/purge';

export interface TrashPurgeWorkflowPayload {
  limit?: number;
  remainingBatches?: number;
}

/** Queue one bounded retention-sweep request when QStash is configured. */
export const triggerTrashPurge = async (payload: TrashPurgeWorkflowPayload = {}) => {
  if (!process.env.QSTASH_TOKEN) return false;

  const baseUrl = appEnv.INTERNAL_APP_URL || appEnv.APP_URL;
  await qstashClient.publishJSON({
    body: payload,
    url: new URL(TRASH_PURGE_WORKFLOW_PATH, baseUrl).toString(),
  });
  return true;
};
