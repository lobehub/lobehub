import { createHash } from 'node:crypto';

import type { VerifyCheckItem } from '@lobechat/types';

import type { NewVerifyCheckResult } from '@/database/schemas/verify';

/**
 * Stable, short fingerprint of a verifier config — snapshotted onto the result
 * row (the Toulmin "Backing" anchor) so a verdict records exactly which config
 * produced it. Shared by the executor and the evidence ingestion path so a
 * result row created by either side hashes identically.
 */
export const hashConfig = (config: Record<string, unknown>): string =>
  createHash('sha256')
    .update(JSON.stringify(config ?? {}))
    .digest('hex')
    .slice(0, 16);

/**
 * The initial `pending` result row for a plan item — the denormalized snapshot
 * (title / required / index / verifier) frozen at the moment a result first
 * exists for the item, whether that's the executor starting the run or an agent
 * uploading evidence mid-run. Keyed canonically by `verifyRunId`, with the
 * Agent Run id kept as the denormalized `operationId` link. Ownership columns
 * are injected by the model.
 */
export const planItemToPendingResult = (
  verifyRunId: string,
  operationId: string | null,
  item: VerifyCheckItem,
): Omit<NewVerifyCheckResult, 'userId' | 'workspaceId'> => ({
  checkItemId: item.id,
  checkItemIndex: item.index,
  checkItemTitle: item.title,
  operationId,
  required: item.required,
  status: 'pending',
  verifierConfigHash: hashConfig(item.verifierConfig),
  verifierType: item.verifierType,
  verifyRunId,
});
