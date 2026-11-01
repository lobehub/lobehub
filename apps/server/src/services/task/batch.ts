import type { TaskItem } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import pMap from 'p-map';

import { AgentModel } from '@/database/models/agent';
import { taskActivityActor, TaskModel } from '@/database/models/task';
import { withStaleReposCleared } from '@/database/models/task/utils';
import { TaskArchiveModel } from '@/database/models/taskArchive';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import type { LobeChatDatabase } from '@/database/type';
import { EditLockService } from '@/server/services/editLock';

import { AiAgentService } from '../aiAgent';
import { TaskRunnerService } from '../taskRunner';
import { assertArchivedTaskStaysIdle, findTasksInOpenGoals } from './archiveGuard';
import { notifyAssignedBestEffort } from './assignmentNotification';
import type { TaskBatchStatus } from './batchLimits';
import { isTaskRunStarting, TaskService } from './index';
import { assertAssigneeAgentBelongsToUser } from './patchValidation';
import { interruptTaskOperation } from './utils';

const FINISHED_STATUSES = new Set(['canceled', 'completed']);

/** Remote operation interrupts / per-task fallbacks issued by one batch. */
const BATCH_SIDE_EFFECT_CONCURRENCY = 5;
/** Cheap per-task checks (Redis edit lock, goal ownership). */
const BATCH_CHECK_CONCURRENCY = 20;

export type TaskBatchSkipReason =
  /** The task is part of an open goal and cannot be archived. */
  | 'inGoal'
  /** Another member is editing the task. */
  | 'locked'
  /** Not found, or not visible to the caller. */
  | 'notFound'
  /** Running, or its schedule / heartbeat can still fire. */
  | 'running'
  /** Already in the requested state. */
  | 'unchanged'
  /** The change would break a visibility or archive invariant. */
  | 'invalid';

export interface TaskBatchResult {
  failed: { error: string; id: string }[];
  /**
   * The status change committed, but its completion follow-ups (parent
   * checkpoint pause, starting unlocked dependents) failed afterwards. The
   * tasks are completed; the caller should say the follow-ups did not run.
   */
  followUpFailed?: boolean;
  skipped: { id: string; reason: TaskBatchSkipReason }[];
  /** Ids (as stored, not the caller's refs) that the batch changed. */
  updated: string[];
}

export interface TaskBatchFieldsPatch {
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  priority?: number;
}

type Actor = { agentId?: string | null; userId?: string | null };

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error');

/**
 * Bulk task edits for the list's multi-select actions. Each method takes the
 * whole selection in one request and writes it with set-based statements and
 * one activity INSERT, instead of the client fanning out one request (and one
 * transaction, and one list refresh) per task.
 *
 * Every invariant the single-task write paths enforce is still applied — per
 * task, against a snapshot read in one query. A task that fails a check is
 * reported as skipped rather than aborting the whole batch, so a selection of
 * hundreds still lands everything it legitimately can.
 */
export class TaskBatchService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;
  private readonly taskModel: TaskModel;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.taskModel = new TaskModel(db, userId, workspaceId);
  }

  /**
   * Load the selection in one query. Ids the caller cannot see come back as
   * `notFound`, the same answer the single-task paths give.
   */
  private async loadSelection(ids: string[]) {
    const unique = [...new Set(ids)];
    const tasks = await this.taskModel.findByIds(unique);
    const found = new Set(tasks.map((task) => task.id));
    const result: TaskBatchResult = {
      failed: [],
      skipped: unique.filter((id) => !found.has(id)).map((id) => ({ id, reason: 'notFound' })),
      updated: [],
    };
    return { result, tasks };
  }

  /** Drop tasks another workspace member is editing (inert in personal mode). */
  private async withoutEditLocked(tasks: TaskItem[], result: TaskBatchResult) {
    if (!this.workspaceId || tasks.length === 0) return tasks;
    const editLock = new EditLockService(this.userId);
    const blocked = await pMap(
      tasks,
      async (task) => !!(await editLock.getBlockingHolder('task', task.id)),
      { concurrency: BATCH_CHECK_CONCURRENCY },
    );
    return tasks.filter((task, index) => {
      if (!blocked[index]) return true;
      result.skipped.push({ id: task.id, reason: 'locked' });
      return false;
    });
  }

  /**
   * Set priority and / or assignees on many tasks. The assignees are validated
   * once for the whole batch; per-task visibility rules and "running tasks keep
   * their assignee" are applied to each row.
   */
  async updateFields(
    ids: string[],
    patch: TaskBatchFieldsPatch,
    actor: Actor,
  ): Promise<{ result: TaskBatchResult; tasks: TaskItem[] }> {
    const { assigneeAgentId, assigneeUserId, priority } = patch;
    const changesAssignee = assigneeAgentId !== undefined || assigneeUserId !== undefined;
    if (!changesAssignee && priority === undefined) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nothing to update' });
    }

    const taskService = new TaskService(this.db, this.userId, this.workspaceId);
    // Selection-independent checks: a bad assignee fails the request outright,
    // exactly like the single-task update.
    await assertAssigneeAgentBelongsToUser(
      this.db,
      { userId: this.userId, workspaceId: this.workspaceId },
      assigneeAgentId,
    );
    await taskService.assertAssigneeUserAssignable(assigneeUserId);
    const agentVisibility = assigneeAgentId
      ? await new AgentModel(this.db, this.userId, this.workspaceId).getAgentVisibility(
          assigneeAgentId,
        )
      : null;

    const { result, tasks } = await this.loadSelection(ids);
    const candidates = (await this.withoutEditLocked(tasks, result)).filter((task) => {
      // A running task's assignee is the agent doing the work; the row picker
      // is disabled for it, and so is the batch.
      if (changesAssignee && task.status === 'running') {
        result.skipped.push({ id: task.id, reason: 'running' });
        return false;
      }
      try {
        if (assigneeAgentId)
          taskService.assertAgentVisibilityCompat(task.visibility, agentVisibility);
        taskService.assertAssigneeUserVisibilityCompat(
          task.visibility,
          assigneeUserId,
          task.createdByUserId,
        );
      } catch {
        result.skipped.push({ id: task.id, reason: 'invalid' });
        return false;
      }
      return true;
    });

    const data: TaskBatchFieldsPatch = {};
    if (assigneeAgentId !== undefined) data.assigneeAgentId = assigneeAgentId;
    if (assigneeUserId !== undefined) data.assigneeUserId = assigneeUserId;
    if (priority !== undefined) data.priority = priority;

    const updatedTasks = await this.db.transaction(async (tx) => {
      const model = new TaskModel(tx, this.userId, this.workspaceId);
      // Serialize with a concurrent member removal, like the single-task
      // assignee write: the member row stays locked until this commit.
      if (assigneeUserId) {
        await new TaskService(tx, this.userId, this.workspaceId).assertAssigneeUserAssignableLocked(
          tx,
          assigneeUserId,
        );
      }
      // Decide and describe each row from its locked state, so the activity
      // log never names a transition a concurrent edit already superseded.
      const lockedRows = await model.lockForBulkEdit(candidates.map((task) => task.id));
      const lockedIds = new Set(lockedRows.map((row) => row.id));
      for (const task of candidates) {
        if (!lockedIds.has(task.id)) result.skipped.push({ id: task.id, reason: 'notFound' });
      }
      // The snapshot checks above are re-applied to the locked rows: a task
      // that started running or turned private since then is left alone.
      const locked = lockedRows.filter((row) => {
        if (changesAssignee && row.status === 'running') {
          result.skipped.push({ id: row.id, reason: 'running' });
          return false;
        }
        try {
          if (assigneeAgentId)
            taskService.assertAgentVisibilityCompat(row.visibility, agentVisibility);
          taskService.assertAssigneeUserVisibilityCompat(
            row.visibility,
            assigneeUserId,
            row.createdByUserId,
          );
        } catch {
          result.skipped.push({ id: row.id, reason: 'invalid' });
          return false;
        }
        return true;
      });

      const changing = locked.filter(
        (row) =>
          (data.assigneeAgentId !== undefined && row.assigneeAgentId !== data.assigneeAgentId) ||
          (data.assigneeUserId !== undefined && row.assigneeUserId !== data.assigneeUserId) ||
          (data.priority !== undefined && (row.priority ?? null) !== data.priority),
      );
      const changingIds = new Set(changing.map((row) => row.id));
      for (const row of locked) {
        if (!changingIds.has(row.id)) result.skipped.push({ id: row.id, reason: 'unchanged' });
      }

      // Moving a task off an agent drops that agent's cloud-repo selection
      // (`withStaleReposCleared`). The cleared config is computed from each
      // locked row and written by the same single UPDATE as the shared patch,
      // so a large reassignment is one statement, not one write per task.
      const configById = new Map<string, unknown>();
      for (const row of changing) {
        const rowData = withStaleReposCleared(row, data);
        if (rowData !== data) configById.set(row.id, rowData.config);
      }
      const written = await model.updateFieldsForIds(
        changing.map((row) => row.id),
        data,
        configById,
      );

      const { actorKind, ...actorColumns } = taskActivityActor(actor);
      const after = new Map(written.map((task) => [task.id, task]));
      await model.addActivities(
        changing.flatMap((before) => {
          const updated = after.get(before.id);
          if (!updated) return [];
          const base = { ...actorColumns, taskId: before.id, visibility: before.visibility };
          const rows = [];
          if (before.assigneeAgentId !== updated.assigneeAgentId) {
            rows.push({
              ...base,
              payload: { actorKind, fromId: before.assigneeAgentId, toId: updated.assigneeAgentId },
              type: 'assignee_agent' as const,
            });
          }
          if (before.assigneeUserId !== updated.assigneeUserId) {
            rows.push({
              ...base,
              payload: { actorKind, fromId: before.assigneeUserId, toId: updated.assigneeUserId },
              type: 'assignee_user' as const,
            });
          }
          if ((before.priority ?? null) !== (updated.priority ?? null)) {
            rows.push({
              ...base,
              payload: { actorKind, from: before.priority ?? null, to: updated.priority ?? null },
              type: 'priority' as const,
            });
          }
          return rows;
        }),
      );

      return changing
        .filter((row) => after.has(row.id))
        .map((row) => ({ before: row, task: after.get(row.id)! }));
    });

    result.updated = updatedTasks.map(({ task }) => task.id);
    const scope = { userId: this.userId, workspaceId: this.workspaceId };
    for (const { before, task } of updatedTasks) {
      // Only an actual assignee change notifies (self-assignment stays silent).
      if (task.assigneeUserId !== before.assigneeUserId) notifyAssignedBestEffort(scope, task);
    }
    return { result, tasks: updatedTasks.map(({ task }) => task) };
  }

  /**
   * Move many tasks to one status in a single transaction. Mirrors
   * `updateStatusCascade`: interrupt live runs first, then cancel their topics,
   * write every status and log every transition together, and run completion
   * side effects (checkpoints, dependency unlocks) once for the whole set.
   */
  async updateStatus(
    ids: string[],
    status: TaskBatchStatus,
    actor: Actor,
  ): Promise<{ result: TaskBatchResult; tasks: TaskItem[] }> {
    const { result, tasks } = await this.loadSelection(ids);
    const candidates = (await this.withoutEditLocked(tasks, result)).filter((task) => {
      if (task.status === status) {
        result.skipped.push({ id: task.id, reason: 'unchanged' });
        return false;
      }
      try {
        assertArchivedTaskStaysIdle(task, { status });
      } catch {
        result.skipped.push({ id: task.id, reason: 'invalid' });
        return false;
      }
      return true;
    });

    const taskTopicModel = new TaskTopicModel(this.db, this.userId, this.workspaceId);
    const aiAgentService = new AiAgentService(this.db, this.userId, {
      workspaceId: this.workspaceId,
    });

    // Leaving `running` stops the run first. A task whose run cannot be
    // interrupted is left as it is (and reported), never shown as stopped
    // while it is still executing.
    const allRunningTopics = await taskTopicModel.findRunningByTaskIds(
      candidates.map((task) => task.id),
    );
    // A run still starting (dispatched, operation not recorded yet) has
    // nothing to interrupt; stopping its task now would leave the agent
    // running under a task shown as stopped. Skip it, as `deleteTask` does.
    const starting = new Set(
      candidates
        .filter((task) =>
          isTaskRunStarting(
            task,
            allRunningTopics.filter((topic) => topic.taskId === task.id),
          ),
        )
        .map((task) => task.id),
    );
    for (const id of starting) result.skipped.push({ id, reason: 'running' });
    const runningTopics = allRunningTopics.filter((topic) => !starting.has(topic.taskId));
    const interruptFailed = new Set<string>();
    const failedOperations = new Set<string>();
    await pMap(
      runningTopics.filter((topic) => topic.operationId),
      async (topic) => {
        try {
          await interruptTaskOperation(aiAgentService, topic.operationId!);
        } catch (error) {
          failedOperations.add(topic.operationId!);
          if (!interruptFailed.has(topic.taskId)) {
            interruptFailed.add(topic.taskId);
            result.failed.push({ error: errorMessage(error), id: topic.taskId });
          }
        }
      },
      { concurrency: BATCH_SIDE_EFFECT_CONCURRENCY },
    );
    // A task with several runs may have had some of them stopped before one
    // failed: record those as canceled so a stopped operation is never left
    // looking live (same as `updateStatusCascade`).
    for (const topic of runningTopics) {
      if (!interruptFailed.has(topic.taskId) || !topic.topicId) continue;
      if (topic.operationId && failedOperations.has(topic.operationId)) continue;
      await taskTopicModel.cancelIfRunning(topic.taskId, topic.topicId).catch(() => undefined);
    }
    const targetIds = candidates
      .filter((task) => !interruptFailed.has(task.id) && !starting.has(task.id))
      .map((task) => task.id);
    const wasRunning = new Set(
      candidates.filter((task) => task.status === 'running').map((task) => task.id),
    );

    const extra =
      status === 'completed' || status === 'canceled' ? { completedAt: new Date() } : undefined;
    let updatedTasks: TaskItem[] = [];
    let canceledTopics: Awaited<ReturnType<TaskTopicModel['cancelRunningByTaskIds']>> = [];
    await this.db.transaction(async (tx) => {
      const model = new TaskModel(tx, this.userId, this.workspaceId);
      const locked = await model.lockForBulkEdit(targetIds);
      // Same rule `writeKeepingArchivedIdle` applies to one row, checked per
      // locked row: a task archived since the snapshot is skipped, not allowed
      // to come out of this write live, and not allowed to fail the batch.
      const changing = locked.filter((row) => {
        if (row.status === status) {
          result.skipped.push({ id: row.id, reason: 'unchanged' });
          return false;
        }
        // Started a run after the interrupt pass above: that run was never
        // stopped, so this task is left to it rather than shown as stopped.
        if (row.status === 'running' && !wasRunning.has(row.id)) {
          result.skipped.push({ id: row.id, reason: 'running' });
          return false;
        }
        try {
          assertArchivedTaskStaysIdle(row, { status });
        } catch {
          result.skipped.push({ id: row.id, reason: 'invalid' });
          return false;
        }
        return true;
      });
      const changingIds = changing.map((row) => row.id);

      canceledTopics = await new TaskTopicModel(
        tx,
        this.userId,
        this.workspaceId,
      ).cancelRunningByTaskIds(changingIds);
      updatedTasks = await model.updateStatusForIds(changingIds, status, extra);

      const { actorKind, ...actorColumns } = taskActivityActor(actor);
      await model.addActivities(
        changing.map((before) => ({
          ...actorColumns,
          payload: { actorKind, from: before.status, to: status },
          taskId: before.id,
          type: 'status' as const,
          visibility: before.visibility,
        })),
      );
    });
    result.updated = updatedTasks.map((task) => task.id);

    // Best-effort: stop operations that only showed up inside the transaction.
    const interrupted = new Set(runningTopics.map((topic) => topic.operationId));
    await pMap(
      canceledTopics.filter((topic) => topic.operationId && !interrupted.has(topic.operationId)),
      (topic) =>
        aiAgentService.interruptTask({ operationId: topic.operationId! }).catch(() => undefined),
      { concurrency: BATCH_SIDE_EFFECT_CONCURRENCY },
    );

    // Post-commit: the tasks are completed whatever happens here, so a failure

    // must not turn the whole request into an error the client would retry —

    // a retry finds every row `unchanged` and changes nothing. Report it

    // instead. (Re-running the follow-ups automatically on a later retry is

    // deliberately avoided: it would start agent runs on dependents a person

    // may have parked in the backlog on purpose.)

    if (status === 'completed' && updatedTasks.length > 0) {
      try {
        await this.afterCompletion(updatedTasks);
      } catch (error) {
        console.error('[TaskBatchService.updateStatus] completion follow-ups failed', error);

        result.followUpFailed = true;
      }
    }

    return { result, tasks: updatedTasks };
  }

  /** Checkpoint pauses and dependency unlocks for a set of just-completed tasks. */
  private async afterCompletion(completed: TaskItem[]) {
    const parentIds = [
      ...new Set(completed.map((task) => task.parentTaskId).filter((id): id is string => !!id)),
    ];
    const parents = new Map(
      (await this.taskModel.findByIds(parentIds)).map((parent) => [parent.id, parent]),
    );
    const toPause = new Map<string, string>();
    for (const task of completed) {
      const parent = task.parentTaskId ? parents.get(task.parentTaskId) : undefined;
      if (!parent || toPause.has(parent.id)) continue;
      // A checkpoint pauses work in progress. A parent that is already closed
      // — typically completed in this same batch — must not be re-opened.
      if (FINISHED_STATUSES.has(parent.status)) continue;
      if (this.taskModel.shouldPauseAfterComplete(parent, task))
        toPause.set(parent.id, parent.status);
    }
    // One compare-and-set for every parent, on the status just inspected: a
    // parent another request finished or canceled since the snapshot is left
    // alone.
    await this.taskModel.updateStatusIfCurrentForIds(
      [...toPause].map(([id, status]) => ({ id, status })),
      'paused',
    );

    const runner = new TaskRunnerService(this.db, this.userId, this.workspaceId);
    await runner.cascadeOnCompletionMany(completed.map((task) => task.id));
  }

  /**
   * Archive or restore many tasks. Archiving keeps the single-task guards:
   * tasks in an open goal are refused, and the not-running / no-live-automation
   * rule is part of the one UPDATE, so a run starting concurrently still wins.
   */
  async archive(ids: string[], archived: boolean): Promise<TaskBatchResult> {
    const { result, tasks } = await this.loadSelection(ids);
    const archiveModel = new TaskArchiveModel(this.db, this.userId, this.workspaceId);

    const candidates = tasks.filter((task) => {
      if (!!task.archivedAt === archived) {
        result.skipped.push({ id: task.id, reason: 'unchanged' });
        return false;
      }
      return true;
    });

    if (!archived) {
      const restored = await archiveModel.unarchiveMany(candidates.map((task) => task.id));
      result.updated = restored.map((task) => task.id);
      return result;
    }

    // One bulk lookup for the whole selection, not one goal probe per task.
    const inGoal = await findTasksInOpenGoals(
      this.db,
      { userId: this.userId, workspaceId: this.workspaceId },
      candidates,
    );
    const eligible = candidates.filter((task) => {
      if (!inGoal.has(task.id)) return true;
      result.skipped.push({ id: task.id, reason: 'inGoal' });
      return false;
    });

    const archivedRows = await archiveModel.archiveMany(eligible.map((task) => task.id));
    const done = new Set(archivedRows.map((task) => task.id));
    for (const task of eligible) {
      if (!done.has(task.id)) result.skipped.push({ id: task.id, reason: 'running' });
    }
    result.updated = [...done];
    return result;
  }

  /**
   * Delete many tasks. Idle tasks go in one transaction (row locks, linked
   * topics, status-guarded delete); tasks with a live run take the single-task
   * path, which interrupts the run before removing the row.
   */
  async delete(ids: string[]): Promise<TaskBatchResult> {
    // Same scope as the single-task delete: any member who can edit tasks may
    // delete a task they can see, whoever created it. The client confirms
    // explicitly when the selection includes other members' tasks.
    const { result, tasks } = await this.loadSelection(ids);
    const taskTopicModel = new TaskTopicModel(this.db, this.userId, this.workspaceId);
    const running = await taskTopicModel.findRunningByTaskIds(tasks.map((task) => task.id));
    const busy = new Set([
      ...running.map((topic) => topic.taskId),
      ...tasks.filter((task) => task.status === 'running').map((task) => task.id),
    ]);

    const idle = tasks.filter((task) => !busy.has(task.id));
    const deletedIdle = await this.db.transaction(async (tx) => {
      const model = new TaskModel(tx, this.userId, this.workspaceId);
      const txTopics = new TaskTopicModel(tx, this.userId, this.workspaceId);
      // The row lock is the one a run takes to record its topic: anything that
      // started after the snapshot is visible now and is left for the
      // single-task path below.
      const locked = await model.lockForStatusChange(idle.map((task) => task.id));
      const startedMeanwhile = new Set(
        (await txTopics.findRunningByTaskIds(locked.map((row) => row.id))).map(
          (topic) => topic.taskId,
        ),
      );
      const deletable = locked.filter(
        (row) => row.status !== 'running' && !startedMeanwhile.has(row.id),
      );
      const deletableIds = new Set(deletable.map((row) => row.id));
      for (const row of locked) {
        if (!deletableIds.has(row.id)) busy.add(row.id);
      }

      const topicIds = (await txTopics.findByTaskIds(deletable.map((row) => row.id)))
        .map((topic) => topic.topicId)
        .filter((topicId): topicId is string => !!topicId);
      const deleted = await model.deleteIfStatusForIds(deletable);
      if (topicIds.length > 0) {
        // Same cascade as the single delete: linked topics (including ones in
        // the recycle bin) go with the task instead of lingering as orphans.
        await new TopicModel(tx, this.userId, this.workspaceId).batchDeleteIncludingTrashed(
          topicIds,
        );
      }
      return deleted;
    });
    result.updated.push(...deletedIdle);

    const taskService = new TaskService(this.db, this.userId, this.workspaceId);
    await pMap(
      tasks.filter((task) => busy.has(task.id)),
      async (task) => {
        try {
          await taskService.deleteTask(task.id);
          result.updated.push(task.id);
        } catch (error) {
          result.failed.push({ error: errorMessage(error), id: task.id });
        }
      },
      { concurrency: BATCH_SIDE_EFFECT_CONCURRENCY },
    );

    return result;
  }
}
