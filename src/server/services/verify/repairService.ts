import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { VerifyCheckResultModel } from '@/database/models/verifyCheckResult';
import type { VerifyCheckItem, VerifyCheckResultItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';

import { VerifyStatusService } from './statusService';

const log = debug('lobe-server:verify-repair');

/**
 * Spawns a repair sub agent_operations (parent = the failed run) seeded with the
 * failed criteria. Injected by the runtime layer (Phase 7) since it needs full
 * runtime context. The new operation gets its own plan and is re-verified on its
 * own completion (the next "round").
 */
export interface RepairSpawner {
  (args: {
    failedItemIds: string[];
    instruction: string;
    operationId: string;
  }): Promise<{ repairOperationId: string } | null>;
}

const isFailed = (r: VerifyCheckResultItem | undefined): boolean =>
  !!r && (r.status === 'failed' || r.verdict === 'failed' || r.verdict === 'uncertain');

const buildInstruction = (
  failures: { item: VerifyCheckItem; result: VerifyCheckResultItem | undefined }[],
): string => {
  const lines = failures.map(({ item, result }, i) => {
    const why = result?.suggestion || result?.toulmin?.reasoning || 'did not pass verification';
    return `${i + 1}. ${item.title} — ${why}`;
  });
  return [
    'The delivery checker found unresolved issues with the previous result. Fix only these, then stop:',
    ...lines,
  ].join('\n');
};

export class VerifyRepairService {
  private readonly operationModel: AgentOperationModel;
  private readonly resultModel: VerifyCheckResultModel;
  private readonly statusService: VerifyStatusService;

  constructor(db: LobeChatDatabase, userId: string) {
    this.operationModel = new AgentOperationModel(db, userId);
    this.resultModel = new VerifyCheckResultModel(db, userId);
    this.statusService = new VerifyStatusService(db, userId);
  }

  /** Collect the auto-repairable failures for a run. */
  async collectRepairable(operationId: string) {
    const state = await this.operationModel.getVerifyState(operationId);
    const plan = (state?.verifyPlan ?? []) as VerifyCheckItem[];
    const results = await this.resultModel.listByOperation(operationId);
    const byItem = new Map(results.map((r) => [r.checkItemId, r]));

    return plan
      .filter((item) => item.onFail === 'auto_repair' && isFailed(byItem.get(item.id)))
      .map((item) => ({ item, result: byItem.get(item.id) }));
  }

  /**
   * Trigger one round of auto-repair. Returns the repair operation id, or null
   * when there's nothing to repair or no spawner is available in this context.
   */
  async triggerAutoRepair(
    operationId: string,
    spawner?: RepairSpawner,
  ): Promise<{ repairOperationId: string } | null> {
    const failures = await this.collectRepairable(operationId);
    if (failures.length === 0) return null;
    if (!spawner) {
      log('auto-repair eligible for op %s but no spawner available', operationId);
      return null;
    }

    const failedItemIds = failures.map((f) => f.item.id);
    const spawned = await spawner({
      failedItemIds,
      instruction: buildInstruction(failures),
      operationId,
    });
    if (!spawned) return null;

    // Link the repair operation onto each failed result and flip the rollup.
    for (const { item } of failures) {
      await this.resultModel.updateByCheckItem(operationId, item.id, {
        repairOperationId: spawned.repairOperationId,
      });
    }
    await this.statusService.markRepairing(operationId);
    log('triggered auto-repair op %s → %s', operationId, spawned.repairOperationId);

    return spawned;
  }
}
