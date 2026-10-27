import { randomUUID } from 'node:crypto';

import { UNFINISHED_TASK_STATUSES } from '@lobechat/builtin-tool-task';
import type { TaskContext, TaskItem, TaskSchedulerContext, TaskStatus } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import pMap from 'p-map';

import { taskActivityActor, TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';

import { AiAgentService } from '../aiAgent';
import { TaskRunnerService } from '../taskRunner';
import { createTaskSchedulerModule } from '../taskScheduler';
import { assertArchivedTaskStaysIdle, writeKeepingArchivedIdle } from './archiveGuard';
import type { TaskServiceDeps } from './deps';
import { findTaskOrThrow, interruptTaskOperation } from './utils';

/** Concurrent agent-operation interrupts issued by one status cascade. */
const INTERRUPT_CONCURRENCY = 5;

export interface UpdateStatusResult {
  allSubtasksDone?: boolean;
  checkpointTriggered?: boolean;
  /** Completion was requested by the task's own run and lands when it ends. */
  completionDeferred?: boolean;
  parentTaskId?: string | null;
  paused: string[];
  pausedTasks?: { id: string; identifier: string }[];
  task: TaskItem;
  unlocked: string[];
  unlockedTasks?: { id: string; identifier: string }[];
}

export interface UpdateStatusCascadeResult {
  paused: string[];
  pausedTasks?: { id: string; identifier: string }[];
  task: TaskItem;
  unlocked: string[];
  unlockedTasks?: { id: string; identifier: string }[];
  updatedSubtasks: string[];
  updatedSubtaskTasks?: { id: string; identifier: string }[];
}

/**
 * Transition a task to a new status, cascading the side effects:
 *   - leaving `running`: interrupt + cancel still-running topics
 *   - entering `completed`: check parent checkpoint, count sibling
 *     completions, kick off any newly-unlocked downstream tasks.
 */
export async function updateStatus(
  deps: TaskServiceDeps,
  input: {
    error?: string;
    id: string;
    /**
     * The caller's own run, when an agent changes the task it is executing.
     * Completing that task is a delivery request: it is recorded and
     * finalized by onTopicComplete once the run ends, instead of
     * interrupting the run mid-tool-call.
     */
    operationId?: string;
    status: TaskStatus;
  },
  /**
   * Present only for a change a person or their agent made; its absence is
   * how system transitions (runner / lifecycle / watchdog) opt out of the
   * activity feed.
   */
  actor?: { agentId?: string | null; userId?: string | null },
): Promise<UpdateStatusResult> {
  const { id, operationId, status, error: errorMsg } = input;

  if (errorMsg && status !== 'failed') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Task error can only be provided when status is failed.',
    });
  }

  const resolved = await findTaskOrThrow(deps.taskModel, id);
  assertArchivedTaskStaysIdle(resolved, { status });

  if (resolved.status === 'running' && status !== 'running') {
    const topics = await deps.taskTopicModel.findByTaskId(resolved.id);

    if (
      status === 'completed' &&
      operationId &&
      topics.some((t) => t.status === 'running' && t.operationId === operationId)
    ) {
      await deps.taskModel.updateContext(resolved.id, {
        completion: { requestedByOperationId: operationId },
      });
      return { completionDeferred: true, paused: [], task: resolved, unlocked: [] };
    }

    const aiAgentService = new AiAgentService(deps.db, deps.userId, {
      workspaceId: deps.workspaceId,
    });

    for (const t of topics) {
      if (t.status !== 'running' || !t.topicId) continue;

      // Interrupt the remote operation first; if it fails, skip cancellation
      // to avoid desynchronizing DB state from a still-running operation.
      if (t.operationId) {
        try {
          await interruptTaskOperation(aiAgentService, t.operationId);
        } catch (err) {
          console.error('[TaskService.updateStatus] failed to interrupt topic %s:', t.topicId, err);
          throw err;
        }
      }

      await deps.taskTopicModel.cancelIfRunning(resolved.id, t.topicId);
    }
  }

  const extra: Record<string, unknown> = {};
  if (status === 'running') extra.startedAt = new Date();
  if (status === 'completed' || status === 'failed' || status === 'canceled')
    extra.completedAt = new Date();
  if (errorMsg) extra.error = errorMsg;

  const task = await writeKeepingArchivedIdle(deps.db, (tx) => {
    const model = new TaskModel(tx, deps.userId, deps.workspaceId);
    return actor
      ? model.updateWithLog(resolved.id, { status, ...extra }, actor)
      : model.updateStatus(resolved.id, status, extra);
  });
  if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });

  // Stamp the schedule run-count window each time the user (re)starts a
  // scheduled task. The cron dispatcher itself flips a task running →
  // scheduled on every tick, so we exclude that natural cycle by only
  // resetting when the previous status was NOT 'running'. This lets
  // `runScheduleTick` enforce `config.schedule.maxExecutions` by counting
  // task_topics created since this timestamp.
  if (
    status === 'scheduled' &&
    task.automationMode === 'schedule' &&
    resolved.status !== 'running'
  ) {
    await deps.taskModel.updateContext(task.id, {
      scheduler: { scheduleStartedAt: new Date().toISOString() },
    });
  }

  // Heartbeat ticks are one-shot delayed messages that re-arm themselves
  // after each run. Seed the very first message when a user starts/restarts
  // the schedule; otherwise a fresh heartbeat task has no event capable of
  // reaching the lifecycle re-arm path.
  if (
    status === 'scheduled' &&
    task.automationMode === 'heartbeat' &&
    task.heartbeatInterval &&
    task.heartbeatInterval > 0 &&
    resolved.status !== 'running' &&
    resolved.status !== 'scheduled'
  ) {
    const scheduler = createTaskSchedulerModule();
    const schedulerContext = (resolved.context as TaskContext | null)?.scheduler as
      TaskSchedulerContext | undefined;
    const previousTickMessageId = schedulerContext?.tickMessageId;
    const tickToken = randomUUID();
    let tickMessageId: string | undefined;

    try {
      // Invalidate the previous generation before publishing. This closes
      // the race where an old QStash delivery arrives while the replacement
      // message is being created.
      await deps.taskModel.updateContext(task.id, { scheduler: { tickToken } });
      tickMessageId = await scheduler.scheduleNextTopic({
        delay: task.heartbeatInterval,
        taskId: task.id,
        tickToken,
        userId: deps.userId,
      });

      await deps.taskModel.updateContext(task.id, {
        scheduler: {
          consecutiveFailures: schedulerContext?.consecutiveFailures ?? 0,
          scheduledAt: new Date().toISOString(),
          tickMessageId,
          tickToken,
        },
      });
    } catch (error) {
      // Never expose a scheduled status without a persisted tick. Restore
      // the user-visible state and cancel a newly published message when
      // persistence was the failing step.
      if (tickMessageId) await scheduler.cancelScheduled(tickMessageId).catch(() => undefined);
      await deps.taskModel.update(task.id, { context: resolved.context });
      // The logged transition really happened and is now being undone, so
      // the undo is logged too (same actor, back to the same value): the
      // audit trail stays truthful and the feed folds the pair away.
      if (actor) await deps.taskModel.updateWithLog(task.id, { status: resolved.status }, actor);
      else await deps.taskModel.updateStatus(task.id, resolved.status);
      throw error;
    }

    if (previousTickMessageId) {
      await scheduler.cancelScheduled(previousTickMessageId).catch(() => undefined);
    }
  }

  const unlocked: string[] = [];
  const paused: string[] = [];
  const pausedTasks: { id: string; identifier: string }[] = [];
  const unlockedTasks: { id: string; identifier: string }[] = [];
  let allSubtasksDone = false;
  let checkpointTriggered = false;

  if (status === 'completed') {
    if (task.parentTaskId) {
      const parentTask = await deps.taskModel.findById(task.parentTaskId);
      if (parentTask && deps.taskModel.shouldPauseAfterComplete(parentTask, task)) {
        await deps.taskModel.updateStatus(parentTask.id, 'paused');
        checkpointTriggered = true;
      }
      allSubtasksDone = await deps.taskModel.areAllSubtasksCompleted(task.parentTaskId);
    }

    // Unlock blocked tasks and actually kick them off via the runner.
    const runner = new TaskRunnerService(deps.db, deps.userId, deps.workspaceId);
    const cascade = await runner.cascadeOnCompletion(task.id);
    unlocked.push(...cascade.started);
    paused.push(...cascade.paused);
    pausedTasks.push(...(cascade.pausedTasks ?? []));
    unlockedTasks.push(...(cascade.startedTasks ?? []));
  }

  return {
    paused,
    pausedTasks,
    unlockedTasks,
    task,
    unlocked,
    ...(checkpointTriggered && { checkpointTriggered: true }),
    ...(allSubtasksDone && { allSubtasksDone: true, parentTaskId: task.parentTaskId }),
  };
}

/**
 * Transition a parent and every currently unfinished direct subtask as one
 * database transaction. Completion side effects run only after the whole
 * family has reached the target status, so dependency edges cannot start a
 * sibling in the middle of the cascade.
 */
export async function updateStatusCascade(
  deps: TaskServiceDeps,
  input: {
    id: string;
    status: 'canceled' | 'completed';
  },
  /** The person confirming "include subtasks"; absent for system callers. */
  actor?: { agentId?: string | null; userId?: string | null },
): Promise<UpdateStatusCascadeResult> {
  const resolved = await findTaskOrThrow(deps.taskModel, input.id);
  const subtasks = await deps.taskModel.findSubtasks(resolved.id);
  const unfinishedStatuses = new Set<string>(UNFINISHED_TASK_STATUSES);
  const openSubtasks = subtasks.filter((task) => unfinishedStatuses.has(task.status));
  // Freeze the cascade to this snapshot: both the interrupt pass and the
  // status update operate on the same id set, so a subtask created or
  // transitioned after the confirmation dialog is never rewritten.
  const targetTasks = [resolved, ...openSubtasks];
  const targetIds = targetTasks.map((task) => task.id);

  const aiAgentService = new AiAgentService(deps.db, deps.userId, {
    workspaceId: deps.workspaceId,
  });

  const runningTopics = await deps.taskTopicModel.findRunningByTaskIds(targetIds);
  if (runningTopics.length > 0) {
    // Settled-shaped results, in input order, so a failed interrupt never
    // hides which of the others actually stopped.
    const settled = await pMap(
      runningTopics,
      async (topic): Promise<PromiseSettledResult<void>> => {
        try {
          if (topic.operationId) {
            await interruptTaskOperation(aiAgentService, topic.operationId);
          }
          return { status: 'fulfilled', value: undefined };
        } catch (reason) {
          return { reason, status: 'rejected' };
        }
      },
      { concurrency: INTERRUPT_CONCURRENCY },
    );
    const failure = settled.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failure) {
      // Persist the interrupts that did succeed before surfacing the error,
      // so an actually-stopped operation is not left recorded as running.
      for (const [index, topic] of runningTopics.entries()) {
        if (settled[index].status !== 'fulfilled' || !topic.topicId) continue;
        await deps.taskTopicModel
          .cancelIfRunning(topic.taskId, topic.topicId)
          .catch(() => undefined);
      }
      throw failure.reason;
    }
  }

  const completedAt = new Date();
  let updatedTasks: TaskItem[] = [];
  let canceledTopics: Awaited<ReturnType<TaskTopicModel['cancelRunningByTaskIds']>> = [];
  await deps.db.transaction(async (tx) => {
    const taskModel = new TaskModel(tx, deps.userId, deps.workspaceId);
    const taskTopicModel = new TaskTopicModel(tx, deps.userId, deps.workspaceId);

    // Cancel by the frozen id set rather than the pre-read topic list, so a
    // topic that started between the snapshot and this transaction is still
    // closed together with the status update.
    canceledTopics = await taskTopicModel.cancelRunningByTaskIds(targetIds);
    // The pre-transaction snapshot only chose *which* tasks; what each one
    // is leaving is read under the lock, so a collaborator's edit between
    // the dialog and this write is logged as it really was.
    const locked = actor ? await taskModel.lockForStatusChange(targetIds) : [];
    updatedTasks = await taskModel.updateStatusForIds(targetIds, input.status, { completedAt });

    // A person confirmed this for the whole family, so every member that
    // moved gets its own row — one INSERT, not one per task.
    if (actor) {
      const { actorKind, ...actorColumns } = taskActivityActor(actor);
      await taskModel.addActivities(
        locked
          .filter((before) => before.status !== input.status)
          .map((before) => ({
            ...actorColumns,
            payload: { actorKind, from: before.status, to: input.status },
            taskId: before.id,
            type: 'status' as const,
            visibility: before.visibility,
          })),
      );
    }
  });

  // Best-effort: stop any operation discovered only inside the transaction.
  const interruptedOperationIds = new Set(runningTopics.map((topic) => topic.operationId));
  await pMap(
    canceledTopics.filter(
      (topic) => topic.operationId && !interruptedOperationIds.has(topic.operationId),
    ),
    (topic) =>
      aiAgentService.interruptTask({ operationId: topic.operationId! }).catch(() => undefined),
    { concurrency: INTERRUPT_CONCURRENCY },
  );

  const task = updatedTasks.find(({ id }) => id === resolved.id);
  if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });

  const unlocked: string[] = [];
  const paused: string[] = [];
  const pausedTasks: { id: string; identifier: string }[] = [];
  const unlockedTasks: { id: string; identifier: string }[] = [];
  if (input.status === 'completed') {
    const runner = new TaskRunnerService(deps.db, deps.userId, deps.workspaceId);
    const cascade = await runner.cascadeOnCompletionMany(updatedTasks.map(({ id }) => id));
    unlocked.push(...cascade.started);
    paused.push(...cascade.paused);
    pausedTasks.push(...(cascade.pausedTasks ?? []));
    unlockedTasks.push(...(cascade.startedTasks ?? []));
  }

  return {
    paused,
    pausedTasks,
    unlockedTasks,
    task,
    unlocked,
    updatedSubtaskTasks: updatedTasks
      .filter(({ parentTaskId }) => parentTaskId === resolved.id)
      .map(({ id, identifier }) => ({ id, identifier })),
    updatedSubtasks: updatedTasks
      .filter(({ parentTaskId }) => parentTaskId === resolved.id)
      .map(({ identifier }) => identifier),
  };
}
