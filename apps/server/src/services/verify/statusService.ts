import type { VerifyCheckItem, VerifyRunStatus } from '@lobechat/types';
import debug from 'debug';

import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-server:verify-status');

/**
 * Service-layer chokepoint for the denormalized `verify_runs.status` rollup. MUST
 * be the only writer of that column (besides explicit repair / deliver
 * transitions) so the badge never drifts from the underlying results. Addresses
 * sessions by their bound Agent Run (`operationId`) for the agent pipeline.
 */
export class VerifyStatusService {
  private readonly runModel: VerifyRunModel;
  private readonly resultModel: VerifyCheckResultModel;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.runModel = new VerifyRunModel(db, userId, workspaceId);
    this.resultModel = new VerifyCheckResultModel(db, userId, workspaceId);
  }

  /**
   * Derive the rollup from the frozen plan + current results and persist it.
   * Returns the computed status. Gate logic only considers `required` items:
   * - any required result still pending/running → `verifying`
   * - any required result failed → `failed`
   * - else any required result errored (verifier couldn't run) → `errored`
   * - otherwise → `passed`
   * A genuine `failed` dominates an `errored` (the delivery has a real problem to
   * fix, so it should still gate + repair). `skipped` results (e.g. v1 program
   * placeholders) are pass-through.
   */
  async recompute(operationId: string): Promise<VerifyRunStatus | null> {
    const run = await this.runModel.findByOperation(operationId);
    if (!run) return null;

    const plan = (run.plan ?? []) as VerifyCheckItem[];
    if (plan.length === 0) {
      // No plan → nothing to verify. Leave as-is (unverified / skipped).
      return (run.status ?? null) as VerifyRunStatus | null;
    }
    if (!run.planConfirmedAt) return 'planned';

    const results = await this.resultModel.listByRun(run.id);
    const byItem = new Map(results.map((r) => [r.checkItemId, r]));

    const requiredItems = plan.filter((i) => i.required);

    let anyPending = false;
    let anyFailed = false;
    let anyErrored = false;
    for (const item of requiredItems) {
      const result = byItem.get(item.id);
      // A required item without a result yet is still pending.
      if (!result || result.status === 'pending' || result.status === 'running') {
        anyPending = true;
        continue;
      }
      if (result.status === 'failed' || result.verdict === 'failed') anyFailed = true;
      else if (result.status === 'errored') anyErrored = true;
    }

    const status: VerifyRunStatus = anyPending
      ? 'verifying'
      : anyFailed
        ? 'failed'
        : anyErrored
          ? 'errored'
          : 'passed';

    if (status !== run.status) {
      await this.runModel.updateStatus(run.id, status);
      log('rollup op %s (run %s) → %s', operationId, run.id, status);
    }

    return status;
  }

  /** Explicit transitions that aren't derivable from results alone. */
  async markVerifying(operationId: string) {
    await this.setStatus(operationId, 'verifying');
  }

  async markRepairing(operationId: string) {
    await this.setStatus(operationId, 'repairing');
  }

  async markDelivered(operationId: string) {
    await this.setStatus(operationId, 'delivered');
  }

  /** Resolve the session for an Agent Run and write its rollup status. */
  private async setStatus(operationId: string, status: VerifyRunStatus): Promise<void> {
    const run = await this.runModel.findByOperation(operationId);
    if (!run) {
      log('setStatus: no verify run for op %s, skipping %s', operationId, status);
      return;
    }
    await this.runModel.updateStatus(run.id, status);
  }
}
