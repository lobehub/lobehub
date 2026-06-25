import { DEFAULT_BRIEF_ACTIONS } from '@lobechat/types';
import debug from 'debug';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';

import { maybeAutoRepair } from './repairService';
import { VerifyReporterService } from './reporter';

const log = debug('lobe-server:verify-settle');

const TERMINAL_TASK_STATUS = new Set(['canceled', 'completed', 'failed']);

interface ReportContext {
  deliverable: string;
  goal: string;
  modelConfig: { model: string; provider: string };
}

/**
 * Drive the bound task from a settled verify run (LOBE-10624). This is the single
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
    if (run?.status !== 'passed' && run?.status !== 'failed') return;
    if ((run.metadata as { taskDrivenAt?: string } | null)?.taskDrivenAt) return; // already drove

    const op = await new AgentOperationModel(db, userId, workspaceId).findById(operationId);
    if (!op?.taskId) return; // not a task-bound run — nothing to drive

    const taskModel = new TaskModel(db, userId, workspaceId);
    const task = await taskModel.findById(op.taskId);
    if (!task || TERMINAL_TASK_STATUS.has(task.status)) return; // task already settled

    if (run.status === 'passed') {
      // Complete + cascade (checkpoint / sibling rollup / unlock downstream).
      // Dynamic import breaks the static cycle verify → TaskService → aiAgent →
      // agentRuntime completion → verify (the same break agentVerifier uses).
      const { TaskService } = await import('@/server/services/task');
      await new TaskService(db, userId, workspaceId).updateStatus({
        id: op.taskId,
        status: 'completed',
      });
      log('verify passed → task %s completed', op.taskId);
    } else {
      // Failed acceptance → surface for the user (urgent brief) + pause the task.
      await new BriefModel(db, userId, workspaceId).create({
        actions: DEFAULT_BRIEF_ACTIONS['error'],
        agentId: task.assigneeAgentId || undefined,
        priority: 'urgent',
        summary: 'Delivery did not pass verification.',
        taskId: op.taskId,
        title: `${task.identifier} failed verification`,
        trigger: 'task',
        type: 'error',
      });
      await taskModel.updateStatus(op.taskId, 'paused', { error: null });
      log('verify failed → task %s paused + brief', op.taskId);
    }

    // Deferred creator callback (LOBE-10625 × LOBE-10624): verify-bound runs defer
    // the taskCallback from `onTopicComplete` to HERE so the creator only sees the
    // result once verify has accepted (passed) or rejected (failed) the delivery —
    // never an unaccepted output it might act on before a later verify failure.
    // Best-effort; must not block the idempotency marker below.
    try {
      const { TaskResultBridgeService } = await import('@/server/services/taskResultBridge');
      await new TaskResultBridgeService(db, userId, workspaceId).deliver({
        operationId,
        reason: run.status === 'passed' ? 'done' : 'error',
        taskId: op.taskId,
        taskIdentifier: task.identifier,
        topicId: op.topicId ?? undefined,
        ...(run.status === 'failed' && { errorMessage: 'Delivery did not pass verification.' }),
      });
    } catch (error) {
      log('verify-settle creator callback failed for task %s (non-fatal): %O', op.taskId, error);
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
  if (settled?.status !== 'passed' && settled?.status !== 'failed') return;

  // Report only on terminal settle (a single card on the final delivery, not one
  // per repair round). Skipped when the caller lacks the deliverable (agent path).
  if (opts.report) {
    await new VerifyReporterService(db, userId, workspaceId).generateReport({
      ...opts.report,
      verifyRunId: settled.id,
    });
  }

  await driveTaskFromVerify(db, userId, operationId, workspaceId);
};
