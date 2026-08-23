import debug from 'debug';

import { GoalModel } from '@/database/models/goal';
import { TaskModel } from '@/database/models/task';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';

import { AcceptanceService } from './acceptanceService';
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

    // A goal task entering a run round is `running` — the single transition
    // point shared by round 1, reject-spawned rounds and manual restarts.
    // Terminal decisions stay terminal: an accepted (`achieved`) or canceled
    // goal is never silently re-opened by a stray run.
    try {
      const goalModel = new GoalModel(db, userId, workspaceId);
      const goal = await goalModel.findBySubject('task', params.taskId);
      if (
        goal &&
        goal.status !== 'running' &&
        goal.status !== 'achieved' &&
        goal.status !== 'canceled'
      ) {
        await goalModel.updateStatus(goal.id, 'running');
      }
    } catch (error) {
      log('goal running transition failed for task %s (non-fatal): %O', params.taskId, error);
    }

    const verifyConfig = await taskModel.resolveVerifyConfig(params.taskId);

    // Opt-in to verify, then pick the plan shape:
    //  - rubric / ad-hoc criteria  → decomposed multi-item plan (existing path)
    //  - else explicitly enabled OR a one-sentence acceptance requirement set
    //    → coarse single holistic agent check
    //  - no signal at all          → verify stays off
    if (!verifyConfig || verifyConfig.enabled === false) return;
    const hasCriteria = Boolean(
      verifyConfig.verifyRubricId || verifyConfig.verifyCriteriaIds?.length,
    );
    const holistic =
      !hasCriteria && (verifyConfig.enabled === true || Boolean(verifyConfig.requirement?.trim()));
    if (!hasCriteria && !holistic) return;

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
      // Fall back to a single agent-type holistic check when nothing decomposed.
      holisticFallback: holistic,
      operationId: params.operationId,
      requirement: verifyConfig.requirement,
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

      // A task verification round belongs to its business-level Acceptance from
      // the moment the plan is confirmed. This lets the task surface show live
      // planned/verifying/repairing progress instead of waiting for an external
      // ingest command to create the aggregate after verification has finished.
      const acceptanceService = new AcceptanceService(db, userId, workspaceId);
      const acceptance = await acceptanceService.ensureForSubject('task', params.taskId, {
        requirement: verifyConfig.requirement?.trim() || goal,
      });
      // Task verify config is the source that produced this plan. Keep the
      // aggregate goal in lockstep when a later run changes that source.
      await acceptanceService.acceptanceModel.update(acceptance.id, {
        requirement: verifyConfig.requirement?.trim() || goal,
      });
      await acceptanceService.attachRun(run.id, acceptance.id);

      log(
        'instantiated + confirmed verify plan for op %s (%d items), acceptance %s',
        params.operationId,
        run.plan.length,
        acceptance.id,
      );
    }
  } catch (error) {
    log('instantiateVerifyPlanOnStart failed for op %s (non-fatal): %O', params.operationId, error);
  }
};
