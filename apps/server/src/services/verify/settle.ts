import { DEFAULT_BRIEF_ACTIONS } from '@lobechat/types';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';
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
 * (with cascade); `failed` → raise an urgent brief + pause it for the user.
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

    const operationModel = new AgentOperationModel(db, userId, workspaceId);
    const op = await operationModel.findById(operationId);
    const taskOperation = await resolveTaskOperation(operationModel, operationId);
    if (!op || !taskOperation?.taskId) return; // not a task-bound run — nothing to drive

    const taskModel = new TaskModel(db, userId, workspaceId);
    const task = await taskModel.findById(taskOperation.taskId);
    if (!task || TERMINAL_TASK_STATUS.has(task.status)) return; // task already settled

    if (run.status === 'passed') {
      // Complete + cascade (checkpoint / sibling rollup / unlock downstream).
      // The verify → TaskService → aiAgent → agentRuntime completion → verify
      // cycle is safe statically since every use is call-time (inside this fn).
      await new TaskService(db, userId, workspaceId).updateStatus({
        id: taskOperation.taskId,
        status: 'completed',
      });
      log('verify passed → task %s completed', taskOperation.taskId);
    } else {
      // Two non-pass outcomes, kept distinct so an infra error never reads as a
      // rejected delivery:
      // - failed:  the verifier ran and judged the delivery short of the criteria.
      // - errored: the verifier could not run (infra) — the delivery was NOT
      //   evaluated, so we must not claim it "did not pass".
      const isErrored = run.status === 'errored';
      await new BriefModel(db, userId, workspaceId).create({
        actions: DEFAULT_BRIEF_ACTIONS['error'],
        agentId: task.assigneeAgentId || undefined,
        priority: 'urgent',
        summary: isErrored
          ? 'Verification could not run (internal error); the delivery was not evaluated.'
          : 'Delivery did not pass verification.',
        taskId: taskOperation.taskId,
        title: isErrored
          ? `${task.identifier} verification errored`
          : `${task.identifier} failed verification`,
        trigger: 'task',
        type: 'error',
      });
      await taskModel.updateStatus(taskOperation.taskId, 'paused', { error: null });
      log(
        isErrored
          ? 'verify errored → task %s paused + brief'
          : 'verify failed → task %s paused + brief',
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

    await runModel.setMetadata(run.id, { taskDrivenAt: new Date().toISOString() });
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
