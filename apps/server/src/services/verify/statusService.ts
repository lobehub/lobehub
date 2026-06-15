import type { VerifyCheckItem } from '@lobechat/types';
import debug from 'debug';

import type { VerifyStatus } from '@/database/models/agentOperation';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-server:verify-status');

/**
 * Service-layer chokepoint for the denormalized `agent_operations.verify_status`
 * rollup. MUST be the only writer of that column (besides explicit repair /
 * deliver transitions) so the badge never drifts from the underlying results.
 */
export class VerifyStatusService {
  private readonly operationModel: AgentOperationModel;
  private readonly resultModel: VerifyCheckResultModel;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.operationModel = new AgentOperationModel(db, userId, workspaceId);
    this.resultModel = new VerifyCheckResultModel(db, userId, workspaceId);
  }

  /**
   * Derive the rollup from the frozen plan + current results and persist it.
   * Returns the computed status. Gate logic only considers `required` items:
   * - any required result still pending/running → `verifying`
   * - any required result failed → `failed`
   * - otherwise → `passed`
   * `skipped` results (e.g. v1 program placeholders) are pass-through.
   */
  async recompute(operationId: string): Promise<VerifyStatus | null> {
    const state = await this.operationModel.getVerifyState(operationId);
    if (!state) return null;

    const plan = (state.verifyPlan ?? []) as VerifyCheckItem[];
    if (plan.length === 0) {
      // No plan → nothing to verify. Leave as-is (unverified / skipped).
      return state.verifyStatus ?? null;
    }
    if (!state.verifyPlanConfirmedAt) return 'planned';

    const results = await this.resultModel.listByOperation(operationId);
    const byItem = new Map(results.map((r) => [r.checkItemId, r]));

    const requiredItems = plan.filter((i) => i.required);

    let anyPending = false;
    let anyFailed = false;
    for (const item of requiredItems) {
      const result = byItem.get(item.id);
      // A required item without a result yet is still pending.
      if (!result || result.status === 'pending' || result.status === 'running') {
        anyPending = true;
        continue;
      }
      if (result.status === 'failed' || result.verdict === 'failed') anyFailed = true;
    }

    const status: VerifyStatus = anyPending ? 'verifying' : anyFailed ? 'failed' : 'passed';

    if (status !== state.verifyStatus) {
      await this.operationModel.updateVerifyStatus(operationId, status);
      log('rollup op %s → %s', operationId, status);
    }

    return status;
  }

  /** Explicit transitions that aren't derivable from results alone. */
  async markVerifying(operationId: string) {
    await this.operationModel.updateVerifyStatus(operationId, 'verifying');
  }

  async markRepairing(operationId: string) {
    await this.operationModel.updateVerifyStatus(operationId, 'repairing');
  }

  async markDelivered(operationId: string) {
    await this.operationModel.updateVerifyStatus(operationId, 'delivered');
  }
}
