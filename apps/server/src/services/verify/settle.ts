import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { GoalModel } from '@/database/models/goal';
import { TaskModel } from '@/database/models/task';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';
import { scheduleGoalAdvance } from '@/server/services/goal/scheduler';
import { TaskService } from '@/server/services/task';
import { TaskResultBridgeService } from '@/server/services/taskResultBridge';

import { maybeAutoRepair } from './repairService';
import { VerifyReporterService } from './reporter';
import { VerifyStatusService } from './statusService';

const log = debug('lobe-server:verify-settle');

const TERMINAL_TASK_STATUS = new Set(['canceled', 'completed', 'failed']);
const MAX_OPERATION_ANCESTORS = 32;

/**
 * Repair operations are descendants of the task's original operation and do
 * not necessarily repeat `taskId` on every child row. Walk the bounded parent
 * chain so the final repair verdict still settles the owning task.
 */
const resolveTaskOperation = async (operationModel: AgentOperationModel, operationId: string) => {
  let current = await operationModel.findById(operationId);
  let depth = 0;

  while (current && !current.taskId && current.parentOperationId && depth < 10) {
    current = await operationModel.findById(current.parentOperationId);
    depth += 1;
  }

  return current?.taskId ? current : null;
};

/** Collapse every transient `repairing` marker left along a bounded repair chain. */
export const recomputeRepairAncestors = async (
  operationModel: AgentOperationModel,
  statusService: VerifyStatusService,
  operationId: string,
) => {
  const visited = new Set<string>();
  let current = await operationModel.findById(operationId);
  let depth = 0;

  while (current?.parentOperationId && depth < MAX_OPERATION_ANCESTORS) {
    const parentOperationId = current.parentOperationId;
    if (visited.has(parentOperationId)) break;
    visited.add(parentOperationId);

    await statusService.recompute(parentOperationId);
    current = await operationModel.findById(parentOperationId);
    depth += 1;
  }
};

interface ReportContext {
  deliverable: string;
  goal: string;
  modelConfig: { model: string; provider: string };
}

/**
 * Drive the bound task from a settled verify run. This is the single
 * convergence for BOTH settle paths — the inline LLM/program judge
 * (`runVerifyOnCompletion`) and the async agent-verifier writeback
 * (`submitVerifyResult`) — so the task is driven from exactly one place.
 *
 * Once a task-bound run reaches a terminal verdict: `passed` → complete the task
 * (with cascade); `failed` / `errored` → pause it with the reason on the task.
 * Idempotent via a run-metadata marker; best-effort (never throws into verify).
 */
export const driveTaskFromVerify = async (
  db: LobeChatDatabase,
  userId: string,
  operationId: string,
  workspaceId?: string,
): Promise<void> => {
  try {
    const runModel = new VerifyRunModel(db, userId, workspaceId);
    const run = await runModel.findByOperation(operationId);
    // Only act on a terminally settled run (skip pending / verifying / repairing).
    if (run?.status !== 'passed' && run?.status !== 'failed' && run?.status !== 'errored') return;
    if ((run.metadata as { taskDrivenAt?: string } | null)?.taskDrivenAt) return; // already drove
    // Cheap read above, authoritative claim here: concurrent verifier
    // callbacks would otherwise both pass the read and both act — spawning two
    // rounds, or one spawning while the other pauses the task it just started.
    if (!(await runModel.claimTaskDrive(run.id))) return;

    const operationModel = new AgentOperationModel(db, userId, workspaceId);
    const op = await operationModel.findById(operationId);
    const taskOperation = await resolveTaskOperation(operationModel, operationId);
    if (!op || !taskOperation?.taskId) return; // not a task-bound run — nothing to drive

    const taskModel = new TaskModel(db, userId, workspaceId);
    const task = await taskModel.findById(taskOperation.taskId);
    if (!task || TERMINAL_TASK_STATUS.has(task.status)) return; // task already settled

    if (run.status === 'passed') {
      // Verify passing completes the task and cascades (checkpoint / sibling
      // rollup / downstream unlock). A Goal Graph Work Task is an ordinary task
      // here — the coordinator reads its completed status on the next tick and
      // synthesizes the finding from it.
      if (task.automationMode) {
        // Recurring tasks are parked back at `scheduled` and re-armed by the
        // task lifecycle. Verify accepts this run, not the lifetime schedule.
        log('verify passed → recurring task %s remains scheduled', taskOperation.taskId);
      } else {
        // The verify → TaskService → aiAgent → agentRuntime completion → verify
        // cycle is safe statically since every use is call-time (inside this fn).
        await new TaskService(db, userId, workspaceId).updateStatus({
          id: taskOperation.taskId,
          status: 'completed',
        });
        log('verify passed → task %s completed', taskOperation.taskId);
      }
    } else {
      // Two non-pass outcomes, kept distinct so an infra error never reads as a
      // rejected delivery:
      // - failed:  the verifier ran and judged the delivery short of the criteria.
      // - errored: the verifier could not run (infra) — the delivery was NOT
      //   evaluated, so we must not claim it "did not pass".
      const isErrored = run.status === 'errored';

      // `Delivery did not pass verification.` is a contract string, not just
      // copy: the Goal coordinator matches on it to decide whether a paused
      // Work Task should start another attempt or open a decision gate.
      const pauseSummary = isErrored
        ? 'Verification could not run (internal error); the delivery was not evaluated.'
        : 'Delivery did not pass verification.';
      // Verification outcomes belong to the task itself. Do not create an inbox
      // brief here: a verifier rejection/error is not a separate user todo.
      await taskModel.updateStatus(taskOperation.taskId, 'paused', { error: pauseSummary });
      log(
        isErrored ? 'verify errored → task %s paused' : 'verify failed → task %s paused',
        taskOperation.taskId,
      );
    }

    // Deferred creator callback: verify-bound runs defer
    // the taskCallback from `onTopicComplete` to HERE so the creator only sees the
    // result once verify has accepted (passed) or rejected (failed) the delivery —
    // never an unaccepted output it might act on before a later verify failure.
    // Best-effort; must not block the idempotency marker below.
    try {
      const errorMessage =
        run.status === 'failed'
          ? 'Delivery did not pass verification.'
          : run.status === 'errored'
            ? 'Verification could not be completed due to an internal error; the delivery was not evaluated. Please retry or review it manually.'
            : undefined;
      await new TaskResultBridgeService(db, userId, workspaceId).deliver({
        operationId,
        reason: run.status === 'passed' ? 'done' : 'error',
        taskId: taskOperation.taskId,
        taskIdentifier: task.identifier,
        topicId: op.topicId ?? undefined,
        ...(errorMessage && { errorMessage }),
      });
    } catch (error) {
      log(
        'verify-settle creator callback failed for task %s (non-fatal): %O',
        taskOperation.taskId,
        error,
      );
    }

    // A Goal Work Task settling is the event the coordinator waits on: it
    // decides whether to synthesize a finding, start another attempt, or open a
    // decision gate. Queue the advance so the goal keeps moving on its own —
    // this is the server-side driver for long-horizon goals, and without it a
    // goal only progresses while some client keeps ticking it.
    try {
      const goal = await new GoalModel(db, userId, workspaceId).findByWorkTask(
        taskOperation.taskId,
      );
      if (goal) {
        await scheduleGoalAdvance({ goalId: goal.id, userId, workspaceId });
        log('verify-settle → queued goal advance for %s', goal.id);
      }
    } catch (error) {
      log('verify-settle goal advance dispatch failed (non-fatal): %O', error);
    }

    // The drive marker was stamped by the claim at the top of this function.
  } catch (error) {
    log('driveTaskFromVerify failed for op %s (non-fatal): %O', operationId, error);
  }
};

/**
 * Single finalizer for a verification run, called from both settle paths. Runs
 * the repair-aware tail (`maybeAutoRepair` may flip the run to `repairing`), then
 * — only when the run has terminally settled — generates the report (when the
 * caller has the deliverable context) and drives the bound task. Keeping repair +
 * report + task-drive in one place means the task-drive lives in exactly one
 * location regardless of which path completed the last check.
 */
export const finalizeVerifyRun = async (
  db: LobeChatDatabase,
  userId: string,
  operationId: string,
  opts: { report?: ReportContext },
  workspaceId?: string,
): Promise<void> => {
  // Repair-aware: no-ops until every required check is terminal, and may spawn a
  // repair (→ `repairing`), in which case finalize defers to the repair op.
  await maybeAutoRepair(db, userId, operationId, workspaceId);

  const settled = await new VerifyRunModel(db, userId, workspaceId).findByOperation(operationId);
  if (settled?.status !== 'passed' && settled?.status !== 'failed' && settled?.status !== 'errored')
    return;

  // Report only on terminal settle (a single card on the final delivery, not one
  // per repair round). Skipped when the caller lacks the deliverable (agent path)
  // and for `errored` runs, which carry no criteria judgment to report.
  if (opts.report && settled.status !== 'errored') {
    await new VerifyReporterService(db, userId, workspaceId).generateReport({
      ...opts.report,
      verifyRunId: settled.id,
    });
  }

  // The repaired child is now the active/final round. Every failed ancestor may
  // have been stamped `repairing`, so collapse the complete bounded chain back
  // to the verdict derived from each round's own results.
  await recomputeRepairAncestors(
    new AgentOperationModel(db, userId, workspaceId),
    new VerifyStatusService(db, userId, workspaceId),
    operationId,
  );

  await driveTaskFromVerify(db, userId, operationId, workspaceId);
};
