import debug from 'debug';

import { TaskModel } from '@/database/models/task';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';

import { VerifyPlanGeneratorService } from './planGenerator';

const log = debug('lobe-server:verify-plan-instantiation');

export interface InstantiateVerifyPlanParams {
  operationId: string;
  taskId: string;
}

/**
 * Auto-instantiate + auto-confirm a verify plan for a task-bound operation at run
 * start, so the completion-time gate (`runVerifyOnCompletion`) actually fires.
 *
 * Without this, a task's `TaskVerifyConfig` (rubric / criteria) is never turned
 * into a plan, so verify silently no-ops. We resolve the task's verify config
 * (with subtask inheritance), materialize the rubric + ad-hoc criteria into a
 * plan (no AI generation — the task already picked its criteria), and confirm it
 * immediately (task scenario doesn't show a "confirm plan" step).
 *
 * Fire-and-forget + idempotent: never throws (verify must not affect the run),
 * and skips when a plan already exists (recordStart can re-fire).
 */
export const instantiateVerifyPlanOnStart = async (
  db: LobeChatDatabase,
  userId: string,
  params: InstantiateVerifyPlanParams,
  workspaceId?: string,
): Promise<void> => {
  try {
    const taskModel = new TaskModel(db, userId, workspaceId);
    const verifyConfig = await taskModel.resolveVerifyConfig(params.taskId);

    // Opt-in: a task only verifies when it configured a rubric or ad-hoc criteria
    // and hasn't disabled the gate.
    if (!verifyConfig || verifyConfig.enabled === false) return;
    if (!verifyConfig.verifyRubricId && !verifyConfig.verifyCriteriaIds?.length) return;

    const runModel = new VerifyRunModel(db, userId, workspaceId);
    const existing = await runModel.findByOperation(params.operationId);
    // Idempotent: a plan already exists for this run (re-fire, or agent/UI-built).
    if (existing?.plan?.length) return;

    const task = await taskModel.findById(params.taskId);
    const goal = task?.instruction ?? task?.name ?? '';

    const planGenerator = new VerifyPlanGeneratorService(db, userId, workspaceId);
    await planGenerator.generateDraftPlan({
      // No AI proposal — the task's configured rubric/criteria are the plan.
      enableAiGeneration: false,
      goal,
      operationId: params.operationId,
      verifyCriteriaIds: verifyConfig.verifyCriteriaIds,
      verifyRubricId: verifyConfig.verifyRubricId,
    });

    // generateDraftPlan only sets the (draft) plan; the task scenario auto-confirms
    // so the completion gate treats it as ready instead of a pending draft.
    const run = await runModel.findByOperation(params.operationId);
    if (run?.plan?.length) {
      // Carry the task's repair/re-run cap (TaskVerifyConfig.maxIterations) onto
      // the run so auto-repair honors it. Without this the repair path falls back
      // to the source rubric's config or the default, dropping the task cap for
      // ad-hoc-criteria or per-task-override tasks.
      if (typeof verifyConfig.maxIterations === 'number') {
        await runModel.setMetadata(run.id, { maxRepairRounds: verifyConfig.maxIterations });
      }
      await runModel.confirmPlan(run.id);
      log(
        'instantiated + confirmed verify plan for op %s (%d items)',
        params.operationId,
        run.plan.length,
      );
    }
  } catch (error) {
    log('instantiateVerifyPlanOnStart failed for op %s (non-fatal): %O', params.operationId, error);
  }
};
