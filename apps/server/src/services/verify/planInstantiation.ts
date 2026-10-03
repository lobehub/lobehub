import type { VerifyCheckItem } from '@lobechat/types';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import { TaskModel } from '@/database/models/task';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';

import { AcceptanceService, buildAcceptanceCheckUnion } from './acceptanceService';
import { resolveVerifyModelConfig } from './modelConfig';
import { VerifyPlanGeneratorService } from './planGenerator';
import { attachTaskRunToAcceptance, resolveTaskAcceptance } from './taskAcceptance';

const log = debug('lobe-server:verify-plan-instantiation');

/**
 * Whether the run still carries exactly the floor plan we just wrote — i.e.
 * nothing else has authored or confirmed a checklist in the meantime.
 *
 * The guard the refinement step writes behind: `setPlan` replaces the whole
 * plan, so replacing a checklist someone else authored (a builder that hit
 * `authorCriteria` while the generation call was in flight) would invalidate ids
 * they are already evidencing.
 */
const isUntouchedFloorPlan = (
  run: { plan?: VerifyCheckItem[] | null; planConfirmedAt?: Date | null },
  floorItems: VerifyCheckItem[],
): boolean =>
  !run.planConfirmedAt &&
  (run.plan ?? []).map((item) => item.id).join() === floorItems.map((item) => item.id).join();

export interface InstantiateVerifyPlanParams {
  operationId: string;
  taskId: string;
}

/**
 * Auto-instantiate + auto-confirm a verify plan for a task-bound operation at run
 * start, so the completion-time gate (`runVerifyOnCompletion`) actually fires.
 *
 * Without this, a task's Acceptance policy (rubric / criteria) is never turned
 * into a plan, so verify silently no-ops. We resolve the Task's Acceptance and
 * materialize the rubric + ad-hoc criteria into a plan (no AI generation there
 * — the task already picked its criteria), and confirm it immediately (task
 * scenario doesn't show a "confirm plan" step). Only the undecomposed path
 * spends an AI call: the acceptance requirement is split into named criteria so
 * the checklist shows distinguishable items, with the single holistic check as
 * the floor.
 *
 * Ordered so the plan cannot depend on an external call: the floor plan is
 * written and bound first, and the generation call only *refines* what is
 * already there. Generating first meant one provider throw left the run with no
 * plan, no criteria to read, no way to submit evidence and no round on the
 * Task's Acceptance — with the error swallowed.
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

    const task = await taskModel.findById(params.taskId);
    // A recurring task (schedule / heartbeat) is a loop of ticks, not a
    // delivery: a single tick has no acceptance contract, and a failed
    // acceptance would pause the task — permanently disarming its schedule,
    // since the cron query never picks `paused` tasks up again. Verify stays
    // off for automation tasks even when they inherit an Acceptance policy.
    if (task?.automationMode) return;

    const resolvedAcceptance = await resolveTaskAcceptance(db, userId, params.taskId, workspaceId);
    if (!resolvedAcceptance) return;
    const { acceptance, config: verifyConfig, requirement } = resolvedAcceptance;

    // Opt-in to verify, then pick the plan shape:
    //  - rubric / ad-hoc criteria  → decomposed multi-item plan (existing path)
    //  - else explicitly enabled OR a one-sentence acceptance requirement set
    //    → coarse single holistic agent check
    //  - no signal at all          → verify stays off
    if (verifyConfig.enabled === false) return;
    const hasCriteria = Boolean(
      verifyConfig.verifyRubricId || verifyConfig.verifyCriteriaIds?.length,
    );
    const holistic =
      !hasCriteria && (verifyConfig.enabled === true || Boolean(requirement?.trim()));
    if (!hasCriteria && !holistic) return;

    const runModel = new VerifyRunModel(db, userId, workspaceId);
    const existing = await runModel.findByOperation(params.operationId);
    // Idempotent: a plan already exists for this run (re-fire, or agent/UI-built).
    if (existing?.plan?.length) {
      // An agent/UI-built plan never passed through the attach at the end of this
      // function, so the round would stay orphaned from the Task's Acceptance —
      // invisible to the task surface and unreadable by the Goal review.
      //
      // Only once it is confirmed, though. An unconfirmed plan is not a round yet,
      // and binding it would leave a draft the next attempt folds into. The
      // completion lifecycle binds the round anyway once the plan is confirmed.
      if (existing.planConfirmedAt) {
        await attachTaskRunToAcceptance(
          db,
          userId,
          { acceptanceId: acceptance.id, run: existing },
          workspaceId,
        );
      }
      return;
    }

    const goal = task?.instruction ?? task?.name ?? '';

    // Goal retries re-verify the same acceptance checks, including supplementary
    // checks submitted with the delivery. Generating new ids would leave the
    // rejected evidence in the union forever instead of superseding it.
    if (holistic && (await new GoalModel(db, userId, workspaceId).findByGraphTask(params.taskId))) {
      const service = new AcceptanceService(db, userId, workspaceId);
      const { results, runs } = await service.loadRounds(acceptance.id);
      const previousPlan = buildAcceptanceCheckUnion(
        runs.map((run) => ({
          results: results.filter((result) => result.verifyRunId === run.id),
          run,
        })),
      ).flatMap((check) => (check.planItem ? [{ ...check.planItem, id: check.id }] : []));
      if (previousPlan.length) {
        const retry = await runModel.ensureForOperation(params.operationId);
        await runModel.setPlan(retry.id, previousPlan);
        if (typeof verifyConfig.maxIterations === 'number') {
          await runModel.setMetadata(retry.id, { maxRepairRounds: verifyConfig.maxIterations });
        }
        await runModel.confirmPlan(retry.id);
        await service.attachPolicyRun(retry.id, acceptance.id);
        return;
      }
    }

    const planGenerator = new VerifyPlanGeneratorService(db, userId, workspaceId);

    // ── The floor ────────────────────────────────────────────────────────────
    // Everything up to here reads local rows. The plan is written HERE, before
    // any model resolution or generation call, so the run always ends up with a
    // checklist to evidence no matter how the provider behaves.
    const floorItems = await planGenerator.generateDraftPlan({
      context: requirement,
      enableAiGeneration: false,
      goal,
      // The single agent-type holistic check when nothing decomposed into
      // criteria, so verify still runs instead of no-oping.
      holisticFallback: holistic,
      operationId: params.operationId,
      requirement,
      verifyCriteriaIds: verifyConfig.verifyCriteriaIds,
      verifyRubricId: verifyConfig.verifyRubricId,
    });

    const run = await runModel.findByOperation(params.operationId);
    if (!run?.plan?.length) return;
    let finalItemCount = run.plan.length;

    // ── Refinement ───────────────────────────────────────────────────────────
    // Undecomposed acceptance (goal-dispatched Task, one-sentence requirement):
    // spend one generation call splitting the requirement into named criteria, so
    // the checklist reads as distinguishable items instead of one generic "Task
    // delivery acceptance" row. Best-effort by construction: a throw here leaves
    // the floor standing.
    //
    // Skipped when the plan is no longer the floor we just wrote (a builder that
    // got there first through authorCriteria) or is already confirmed — replacing
    // either would invalidate a checklist someone else is working from.
    if (holistic && isUntouchedFloorPlan(run, floorItems)) {
      try {
        const modelConfig = await resolveVerifyModelConfig(
          db,
          userId,
          { verifierAgentId: verifyConfig.verifierAgentId },
          workspaceId,
        );
        const proposed = await planGenerator.proposeAiCriteria({
          // Ground the generated criteria in the acceptance text, not just the title.
          context: requirement,
          existingTitles: [],
          goal,
          modelConfig,
          operationId: params.operationId,
        });
        if (proposed.length) {
          await runModel.setPlan(run.id, proposed);
          finalItemCount = proposed.length;
          log(
            'refined verify plan for op %s with %d generated items',
            params.operationId,
            proposed.length,
          );
        }
      } catch (error) {
        log(
          'AI criteria generation failed for op %s; keeping the floor plan: %O',
          params.operationId,
          error,
        );
      }
    }

    // ── Confirm + bind ───────────────────────────────────────────────────────
    // Reached on every path, so the round is a real round with a real plan even
    // when the refinement above never ran.
    // Carry the Acceptance repair/re-run cap onto the run so auto-repair honors
    // it. Without this the repair path falls back to the source rubric's config
    // or the default, dropping the task cap for ad-hoc-criteria or
    // per-task-override tasks.
    if (typeof verifyConfig.maxIterations === 'number') {
      await runModel.setMetadata(run.id, { maxRepairRounds: verifyConfig.maxIterations });
    }
    await runModel.confirmPlan(run.id);

    // A task verification round belongs to its business-level Acceptance from the
    // moment the plan is confirmed. This lets the task surface show live
    // planned/verifying/repairing progress instead of waiting for an external
    // ingest command to create the aggregate after verification has finished.
    await new AcceptanceService(db, userId, workspaceId).attachPolicyRun(run.id, acceptance.id);

    log(
      'instantiated + confirmed verify plan for op %s (%d items), acceptance %s',
      params.operationId,
      finalItemCount,
      acceptance.id,
    );
  } catch (error) {
    log('instantiateVerifyPlanOnStart failed for op %s (non-fatal): %O', params.operationId, error);
    // Non-fatal for the run, but it must not stay invisible: the builder's
    // `listCriteria` reports this reason, so a run with no criteria says why
    // instead of reading as "this Task has no Acceptance".
    try {
      await new AgentOperationModel(db, userId, workspaceId).mergeMetadata(params.operationId, {
        verifyPlanError: error instanceof Error ? error.message : String(error),
      });
    } catch (recordError) {
      log('failed to record the plan error for op %s: %O', params.operationId, recordError);
    }
  }
};
