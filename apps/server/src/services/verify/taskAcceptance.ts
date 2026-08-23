import type { AcceptanceConfig, TaskVerifyConfig } from '@lobechat/types';

import { AcceptanceModel } from '@/database/models/acceptance';
import { TaskModel } from '@/database/models/task';
import type { AcceptanceItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';

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
  const ownAcceptance = await acceptanceModel.findPolicyBySubject('task', taskId);
  const seen = new Set<string>();
  let currentTaskId: string | null = taskId;
  let inheritedConfig: AcceptanceConfig | undefined;
  let inheritedRequirement: string | undefined;
  let policyAcceptance: AcceptanceItem | undefined;
  let taskProjectId: string | null | undefined;

  while (currentTaskId && !seen.has(currentTaskId)) {
    seen.add(currentTaskId);
    const task = await taskModel.findById(currentTaskId);
    if (!task) break;
    if (currentTaskId === taskId) taskProjectId = task.projectId;

    const acceptance =
      currentTaskId === taskId
        ? ownAcceptance
        : await acceptanceModel.findPolicyBySubject('task', currentTaskId);
    const acceptanceConfig = acceptance?.config ?? {};
    const acceptanceRequirement = acceptance?.requirement?.trim() || undefined;
    if (Object.keys(acceptanceConfig).length > 0 || acceptanceRequirement) {
      policyAcceptance = acceptance;
      inheritedConfig = acceptanceConfig;
      inheritedRequirement = acceptanceRequirement;
      break;
    }

    const legacyVerify = taskModel.getVerifyConfig(task);
    if (legacyVerify) {
      inheritedConfig = toAcceptanceConfig(legacyVerify);
      inheritedRequirement = legacyVerify.requirement?.trim() || undefined;
      break;
    }

    currentTaskId = task.parentTaskId;
  }

  if (!inheritedConfig && !inheritedRequirement) return undefined;

  if (policyAcceptance && currentTaskId === taskId) {
    return {
      acceptance: policyAcceptance,
      config: policyAcceptance.config ?? {},
      requirement: policyAcceptance.requirement ?? undefined,
    };
  }

  const acceptance = ownAcceptance
    ? (await acceptanceModel.updatePolicy(ownAcceptance.id, {
        config: inheritedConfig ?? {},
        requirement: inheritedRequirement,
      }))!
    : await acceptanceModel.ensureForSubject('task', taskId, {
        config: inheritedConfig,
        projectId: taskProjectId,
        requirement: inheritedRequirement,
      });

  return {
    acceptance,
    config: acceptance.config ?? {},
    requirement: acceptance.requirement ?? undefined,
  };
};
