import type { AcceptanceConfig, TaskVerifyConfig } from '@lobechat/types';
import debug from 'debug';

import { AcceptanceModel } from '@/database/models/acceptance';
import { TaskModel } from '@/database/models/task';
import type { AcceptanceItem, VerifyRunItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';

import { AcceptanceService } from './acceptanceService';

const log = debug('lobe-server:verify-task-acceptance');

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

/**
 * Bind a task-bound verification round to the Acceptance that owns the Task's
 * completion contract.
 *
 * `instantiateVerifyPlanOnStart` attaches the plan it creates itself, but a builder
 * that authors its own plan through the CLI (`verify.generateDraftPlan` →
 * `verify.confirmPlan`) writes a round with no acceptance. That round still verifies
 * and still passes, and then the Goal's Acceptance review — which can only reach the
 * delivery through its Acceptance — errors with "no Acceptance". That failure class
 * has no recovery branch, so a delivery that met every criterion ends up parked on a
 * human decision gate.
 *
 * Idempotent and best-effort: a round that already belongs to an acceptance is left
 * alone, and a refusal (already accepted / closed aggregate) must never break verify.
 *
 * Returns the row the round now lives in, which the caller must keep using: attaching
 * onto an acceptance whose newest round is still a draft FOLDS this run into that
 * draft and deletes the source row, moving its operation id across. A caller that
 * kept the id it came in with would go on claiming and reading a row that no longer
 * exists.
 */
export const attachTaskRunToAcceptance = async <
  T extends Pick<VerifyRunItem, 'acceptanceId' | 'id'>,
>(
  db: LobeChatDatabase,
  userId: string,
  params: { acceptanceId: string; run: T },
  workspaceId?: string,
): Promise<T | VerifyRunItem> => {
  if (params.run.acceptanceId) return params.run;

  try {
    const attached = await new AcceptanceService(db, userId, workspaceId).attachPolicyRun(
      params.run.id,
      params.acceptanceId,
    );
    log('attached run %s to task acceptance %s', params.run.id, params.acceptanceId);
    return attached;
  } catch (error) {
    log(
      'could not attach run %s to acceptance %s (non-fatal): %O',
      params.run.id,
      params.acceptanceId,
      error,
    );
    return params.run;
  }
};
