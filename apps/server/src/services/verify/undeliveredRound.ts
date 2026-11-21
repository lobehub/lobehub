import type { AgentOperationStatus } from '@lobechat/types';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';

import { AcceptanceService } from './acceptanceService';

const log = debug('lobe-server:verify-undelivered-round');

/** Terminal states of a run that produced nothing to verify. */
const UNDELIVERED_STATUSES = new Set<AgentOperationStatus>(['abandoned', 'error', 'interrupted']);

/**
 * Take a task run's round off its acceptance when the run ended without a
 * delivery.
 *
 * A task's round is opened when its run starts, before the run has done
 * anything. A run that then fails — the device is offline, the budget is
 * spent, the model is overloaded, the lease expires — never reaches the
 * verifier, so its round stays `planned` for good. Every retry opened
 * another one: the acceptance counted rounds that were never verified, and
 * because its status follows the latest round, it read "awaiting
 * verification" long after the task itself had settled.
 *
 * Repairs are not handled here: a repair's round is the next step of a
 * verification already under way and is closed by `settleFailedRepair`.
 */
export const releaseUndeliveredRound = async (
  db: LobeChatDatabase,
  userId: string,
  operationId: string,
  workspaceId?: string,
): Promise<boolean> => {
  const op = await new AgentOperationModel(db, userId, workspaceId).findById(operationId);
  if (!op || op.parentOperationId || !UNDELIVERED_STATUSES.has(op.status)) return false;

  const runModel = new VerifyRunModel(db, userId, workspaceId);
  const run = await runModel.findByOperation(operationId);
  if (!run?.acceptanceId || run.status !== 'planned') return false;
  if (!(await runModel.detachUndeliveredRound(run.id))) return false;

  await new AcceptanceService(db, userId, workspaceId).recomputeStatus(run.acceptanceId);
  log('released round %d of acceptance %s (op %s)', run.roundIndex, run.acceptanceId, operationId);
  return true;
};
