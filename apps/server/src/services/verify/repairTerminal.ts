import { AgentOperationModel } from '@/database/models/agentOperation';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';

import { planItemToPendingResult } from './resultSnapshot';
import { driveTaskFromVerify, recomputeRepairAncestors } from './settle';
import { VerifyStatusService } from './statusService';

/** Close a repair that died before it could deliver anything to the checker. */
export const settleFailedRepair = async (
  db: LobeChatDatabase,
  userId: string,
  operationId: string,
  workspaceId?: string,
): Promise<boolean> => {
  const operationModel = new AgentOperationModel(db, userId, workspaceId);
  const op = await operationModel.findById(operationId);
  if (!op?.parentOperationId || !['error', 'interrupted'].includes(op.completionReason ?? ''))
    return false;

  const runModel = new VerifyRunModel(db, userId, workspaceId);
  const run = await runModel.findByOperation(operationId);
  if (!run?.planConfirmedAt || !run.plan?.length) return false;
  const parent = await runModel.findByOperation(op.parentOperationId);
  // Evidence/verifier children also have a parent; only a round of that same
  // acceptance is a repair. Standalone verify rounds have no acceptance id.
  if (!parent || parent.acceptanceId !== run.acceptanceId) return false;
  if (run.status !== 'planned' && run.status !== 'errored') return false;

  const statusService = new VerifyStatusService(db, userId, workspaceId);
  if (run.status === 'planned') {
    // Share the judge/sweeper lease so duplicate completion deliveries cannot
    // overwrite results or drive the task twice.
    if (!(await statusService.claimVerifying(operationId, new Date(0)))) return false;
    const results = new VerifyCheckResultModel(db, userId, workspaceId);
    const limitation = `Repair ${op.completionReason} before verification${op.error?.message ? `: ${op.error.message}` : '.'}`;
    for (const item of run.plan) {
      await results.upsertByCheckItem({
        ...planItemToPendingResult(run.id, operationId, item),
        checkItemId: item.id,
        verifyRunId: run.id,
        completedAt: new Date(),
        status: 'errored',
        suggestion: 'Retry the task to resume the repair.',
        toulmin: { limitation },
        verdict: null,
      });
    }
    await statusService.recompute(operationId);
  }

  // Also repeat this on an already-errored round: the child can finish before
  // its spawner stamps the parent `repairing`.
  await recomputeRepairAncestors(operationModel, statusService, operationId);
  if (run.acceptanceId) {
    const rounds = await runModel.listByAcceptance(run.acceptanceId);
    if (rounds.some((round) => (round.roundIndex ?? 0) > (run.roundIndex ?? 0))) return true;
  }
  // Infrastructure failure, not a rejected delivery: do not auto-repair again.
  await driveTaskFromVerify(db, userId, operationId, workspaceId);
  return true;
};
