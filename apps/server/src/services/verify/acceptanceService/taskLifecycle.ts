import debug from 'debug';

import { GoalModel } from '@/database/models/goal';
import { TaskModel } from '@/database/models/task';
import { TaskService } from '@/server/services/task';

import type { AcceptanceServiceDeps } from './deps';

const log = debug('lobe-server:verify-acceptance');

/**
 * Completes a task subject that verification didn't already settle — on
 * accept (e.g. the round failed but the user accepted anyway) and when an
 * ingested round delivers. Best-effort: a task error must not undo the
 * recorded acceptance.
 *
 * `callerOperationId` is the Agent Run that published the delivery. When that
 * run is the task's own running topic, completion is deferred to the end of
 * the run instead of interrupting it mid-tool-call (the agent would read the
 * interrupt as a refused command and stop). A later completion of the same
 * delivery (accept, merged PR) keeps waiting for the run already pending.
 */
export const completeTaskSubject = async (
  deps: AcceptanceServiceDeps,
  subjectId: string,
  callerOperationId?: string,
): Promise<void> => {
  try {
    const taskModel = new TaskModel(deps.db, deps.userId, deps.workspaceId);
    const task = await taskModel.resolve(subjectId);
    if (!task || ['canceled', 'completed', 'failed'].includes(task.status)) return;
    const operationId = callerOperationId ?? pendingCompletionOperation(task);

    // TaskService cascades checkpoint / sibling rollup / downstream unlock —
    // the same completion path settle.ts drives on a passed verify.
    const result = await new TaskService(deps.db, deps.userId, deps.workspaceId).updateStatus({
      id: task.id,
      ...(operationId ? { operationId } : {}),
      status: 'completed',
    });
    if (result.completionDeferred)
      log('acceptance → task %s completes when run %s ends', task.id, operationId);
    else log('acceptance → task %s completed', task.id);
  } catch (error) {
    log('completeTaskSubject failed (non-fatal): %O', error);
  }
};

/** The run a deferred completion waits for — see {@link completeTaskSubject}. */
const pendingCompletionOperation = (task: { context?: unknown }) =>
  (task.context as { completion?: { requestedByOperationId?: string | null } } | null)?.completion
    ?.requestedByOperationId ?? undefined;

/**
 * The task whose status follows its acceptance's lifecycle: delivered →
 * completed, rejected → reopened. Goal graph tasks are driven by their
 * coordinator (a paused task is its retry signal) and recurring tasks stay
 * on their schedule, so neither follows the acceptance.
 */
export const resolveLifecycleTask = async (deps: AcceptanceServiceDeps, subjectId: string) => {
  const task = await new TaskModel(deps.db, deps.userId, deps.workspaceId).resolve(subjectId);
  if (!task || task.automationMode) return null;

  const goal = await new GoalModel(deps.db, deps.userId, deps.workspaceId).findByGraphTask(task.id);
  return goal ? null : task;
};

/**
 * A delivered acceptance completes its task: the delivery is in, and the
 * user's accept / reject decides from here. Shared by every settlement path.
 *
 * A reject can land at any point around the completion, so the decision is
 * read on both sides of the write: rejected before → the task is left alone;
 * rejected in between → the reject saw an unfinished task and did not reopen
 * it, so it is reopened here. Best-effort — never fails the caller.
 *
 * @returns `completed` when the task now reads completed, `rejected` when a
 * reject won, `skipped` when the task does not follow the acceptance or could
 * not be completed — including a completion deferred to the end of
 * `callerOperationId`'s run (see {@link completeTaskSubject}).
 */
export const completeTaskForDelivery = async (
  deps: AcceptanceServiceDeps,
  acceptanceId: string,
  subjectId: string,
  callerOperationId?: string,
): Promise<'completed' | 'rejected' | 'skipped'> => {
  try {
    const task = await resolveLifecycleTask(deps, subjectId);
    if (!task) return 'skipped';

    const before = await deps.acceptanceModel.findPolicyById(acceptanceId);
    if (before?.status === 'rejected') return 'rejected';
    if (before?.status !== 'delivered') return 'skipped';

    await completeTaskSubject(deps, task.id, callerOperationId);
    // `completeTaskSubject` is best-effort and swallows its own failures (e.g. a
    // running operation that could not be interrupted). Only a task that really
    // reads completed counts — anything else lets the caller fall back.
    const written = await new TaskModel(deps.db, deps.userId, deps.workspaceId).findById(task.id);
    // A completion deferred to the caller's run is re-checked like a written
    // one: a reject that read the task before the deferral had nothing to withdraw.
    const deferred =
      written?.status === 'running' &&
      !!callerOperationId &&
      pendingCompletionOperation(written) === callerOperationId;
    if (written?.status !== 'completed' && !deferred) return 'skipped';

    const after = await deps.acceptanceModel.findPolicyById(acceptanceId);
    if (after?.status === 'rejected') {
      await reopenRejectedTaskSubject(deps, task.id);
      return 'rejected';
    }
    return deferred ? 'skipped' : 'completed';
  } catch (error) {
    log('completeTaskForDelivery failed (non-fatal): %O', error);
    return 'skipped';
  }
};

/**
 * Rejecting a delivery reopens the task it completed, so the task is not left
 * reading "done" while its repair is pending. Only a completed task moves —
 * one the user already paused, canceled or restarted keeps its own state.
 *
 * A delivery from the task's own run is completed only once that run ends
 * (see {@link completeTaskSubject}); a reject landing before then withdraws
 * the pending completion, so the run ends the way an undelivered one would.
 */
export const reopenRejectedTaskSubject = async (
  deps: AcceptanceServiceDeps,
  subjectId: string,
): Promise<void> => {
  try {
    let task = await resolveLifecycleTask(deps, subjectId);
    const taskModel = new TaskModel(deps.db, deps.userId, deps.workspaceId);

    if (task?.status === 'running') {
      const pending = pendingCompletionOperation(task);
      if (!pending) return;

      if (await taskModel.withdrawCompletionRequest(task.id, pending)) {
        log(
          'acceptance rejected → task %s pending completion by run %s withdrawn',
          task.id,
          pending,
        );
        return;
      }
      // The run consumed the request first and completed the task: reopen it.
      task = await taskModel.findById(task.id);
    }
    if (task?.status !== 'completed') return;

    await taskModel.updateStatusIfCurrent(task.id, 'completed', 'paused', { completedAt: null });
    log('acceptance rejected → task %s reopened as paused', task.id);
  } catch (error) {
    log('reopenRejectedTaskSubject failed (non-fatal): %O', error);
  }
};
