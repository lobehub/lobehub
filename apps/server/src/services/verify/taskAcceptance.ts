import type { AcceptanceConfig, TaskVerifyConfig } from '@lobechat/types';

import { AcceptanceModel } from '@/database/models/acceptance';
import { TaskModel } from '@/database/models/task';
import type { AcceptanceItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';

import { AcceptanceService } from './acceptanceService';

export interface ResolvedTaskAcceptance {
  acceptance: AcceptanceItem;
  config: AcceptanceConfig;
  requirement?: string;
}

const toAcceptanceConfig = (verify: TaskVerifyConfig): AcceptanceConfig => ({
  enabled: verify.enabled,
  maxIterations: verify.maxIterations,
  verifierAgentId: verify.verifierAgentId,
  verifyCriteriaIds: verify.verifyCriteriaIds,
  verifyRubricId: verify.verifyRubricId,
});

/**
 * Resolve the Acceptance that owns a Task's completion contract.
 *
 * `tasks.config.verify` is read only as a legacy compatibility source. The first
 * read materializes it into the Task's Acceptance; all new flows write the
 * Acceptance directly.
 */
export const resolveTaskAcceptance = async (
  db: LobeChatDatabase,
  userId: string,
  taskId: string,
  workspaceId?: string,
): Promise<ResolvedTaskAcceptance | undefined> => {
  const acceptanceModel = new AcceptanceModel(db, userId, workspaceId);
  const taskModel = new TaskModel(db, userId, workspaceId);
  const [existing, legacyVerify] = await Promise.all([
    acceptanceModel.findBySubject('task', taskId),
    taskModel.resolveVerifyConfig(taskId),
  ]);

  if (!existing && !legacyVerify) return undefined;

  const legacyConfig = legacyVerify ? toAcceptanceConfig(legacyVerify) : undefined;
  const requirement = existing?.requirement ?? legacyVerify?.requirement?.trim() ?? undefined;

  if (!existing) {
    const acceptance = await new AcceptanceService(db, userId, workspaceId).ensureForSubject(
      'task',
      taskId,
      { config: legacyConfig, requirement },
    );
    return {
      acceptance,
      config: acceptance.config ?? {},
      requirement: acceptance.requirement ?? undefined,
    };
  }

  const hasAcceptanceConfig = Object.keys(existing.config ?? {}).length > 0;
  if (hasAcceptanceConfig || !legacyConfig) {
    return {
      acceptance: existing,
      config: existing.config ?? {},
      requirement: existing.requirement ?? undefined,
    };
  }

  const acceptance = (await acceptanceModel.update(existing.id, {
    config: legacyConfig,
    requirement,
  }))!;
  return {
    acceptance,
    config: legacyConfig,
    requirement: acceptance.requirement ?? undefined,
  };
};
