import type { TaskItem } from '@lobechat/types';

import { TaskModel } from '@/database/models/task';
import { TrashModel } from '@/database/models/trash';
import type { LobeChatDatabase } from '@/database/type';

import { TrashService } from '../trash';
import {
  type TaskBatchFieldsPatch,
  type TaskBatchResult,
  type TaskBatchRevert,
  type TaskBatchRevertValues,
  TaskBatchService,
} from './batch';
import { TASK_BATCH_STATUSES, type TaskBatchStatus } from './batchLimits';

type Actor = { agentId?: string | null; userId?: string | null };

const BATCH_STATUS_SET = new Set<string>(TASK_BATCH_STATUSES);

/**
 * The status an undo writes back. A task the batch stopped mid-run cannot be
 * resumed by an undo (the run is gone), so it comes back paused. Statuses a
 * person cannot set directly (failed, scheduled) are not restored.
 */
const revertStatus = (before: string): TaskBatchStatus | undefined => {
  if (BATCH_STATUS_SET.has(before)) return before as TaskBatchStatus;
  if (before === 'running') return 'paused';
  return undefined;
};

/** Whether the task still holds every value the batch wrote (nobody edited it since). */
const stillAfter = (task: TaskItem, after: TaskBatchRevertValues) =>
  (after.status === undefined || task.status === after.status) &&
  (after.archived === undefined || !!task.archivedAt === after.archived) &&
  (after.priority === undefined || (task.priority ?? null) === after.priority) &&
  (after.assigneeAgentId === undefined ||
    (task.assigneeAgentId ?? null) === after.assigneeAgentId) &&
  (after.assigneeUserId === undefined || (task.assigneeUserId ?? null) === after.assigneeUserId);

const groupBy = <T>(items: T[], key: (item: T) => string | undefined) => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === undefined) continue;
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return groups;
};

const merge = (into: TaskBatchResult, from: TaskBatchResult) => {
  into.updated.push(...from.updated);
  into.skipped.push(...from.skipped);
  into.failed.push(...from.failed);
  if (from.followUpFailed) into.followUpFailed = true;
};

/**
 * Undo of the task list's batch actions. Each revert goes back through the
 * same batch write it undoes (status, fields, archive), so every invariant,
 * lock and activity row the forward write had applies to the undo too — it is
 * recorded as the caller's own change. A task someone changed again since the
 * batch is reported as `conflict` and left alone: the undo never overwrites a
 * later edit.
 */
export class TaskBatchRevertService {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  async revert(reverts: TaskBatchRevert[], actor: Actor): Promise<TaskBatchResult> {
    const result: TaskBatchResult = { failed: [], skipped: [], updated: [] };
    const current = new Map(
      (
        await new TaskModel(this.db, this.userId, this.workspaceId).findByIds(
          reverts.map((r) => r.id),
        )
      ).map((task) => [task.id, task]),
    );

    const applicable = reverts.filter((r) => {
      const task = current.get(r.id);
      if (!task) {
        result.skipped.push({ id: r.id, reason: 'notFound' });
        return false;
      }
      if (!stillAfter(task, r.after)) {
        result.skipped.push({ id: r.id, reason: 'conflict' });
        return false;
      }
      return true;
    });

    const batch = new TaskBatchService(this.db, this.userId, this.workspaceId);

    // Status: one forward write per status to go back to.
    const statusReverts = applicable.filter((r) => r.before.status !== undefined);
    for (const [status, group] of groupBy(statusReverts, (r) => revertStatus(r.before.status!))) {
      const { result: part } = await batch.updateStatus(
        group.map((r) => r.id),
        status as TaskBatchStatus,
        actor,
      );
      merge(result, part);
    }
    for (const r of statusReverts) {
      if (!revertStatus(r.before.status!)) result.skipped.push({ id: r.id, reason: 'invalid' });
    }

    // Archive: restore or re-archive.
    const archiveReverts = applicable.filter((r) => r.before.archived !== undefined);
    for (const [archived, group] of groupBy(archiveReverts, (r) => String(r.before.archived))) {
      merge(
        result,
        await batch.archive(
          group.map((r) => r.id),
          archived === 'true',
        ),
      );
    }

    // Fields: one forward write per distinct set of values to put back.
    const fieldReverts = applicable.filter(
      (r) =>
        r.before.priority !== undefined ||
        r.before.assigneeAgentId !== undefined ||
        r.before.assigneeUserId !== undefined,
    );
    const patchOf = (r: TaskBatchRevert): TaskBatchFieldsPatch => ({
      ...(r.before.assigneeAgentId !== undefined && { assigneeAgentId: r.before.assigneeAgentId }),
      ...(r.before.assigneeUserId !== undefined && { assigneeUserId: r.before.assigneeUserId }),
      // A task that had no priority goes back to the default (0, "none").
      ...(r.before.priority !== undefined && { priority: r.before.priority ?? 0 }),
    });
    for (const [key, group] of groupBy(fieldReverts, (r) => JSON.stringify(patchOf(r)))) {
      const { result: part } = await batch.updateFields(
        group.map((r) => r.id),
        JSON.parse(key) as TaskBatchFieldsPatch,
        actor,
      );
      merge(result, part);
    }

    return result;
  }

  /**
   * Undo of a batch delete: bring the tasks back out of the recycle bin (with
   * the topics that went in with them). A task whose parent is still in the
   * bin, or that was purged meanwhile, is reported instead of restored.
   */
  async restoreDeleted(taskIds: string[]): Promise<TaskBatchResult> {
    const result: TaskBatchResult = { failed: [], skipped: [], updated: [] };
    const roots = await new TrashModel(this.db, this.userId, this.workspaceId).findRootsByResources(
      'task',
      taskIds,
    );
    const byRoot = new Map(roots.map((root) => [root.id, root.resourceId]));
    const found = new Set(roots.map((root) => root.resourceId));
    for (const id of taskIds) {
      if (!found.has(id)) result.skipped.push({ id, reason: 'notFound' });
    }

    const outcome = await new TrashService(this.db, this.userId, this.workspaceId).restore([
      ...byRoot.keys(),
    ]);
    result.updated = outcome.restored.map((item) => item.resourceId);
    for (const { code, id } of outcome.failed) {
      const taskId = byRoot.get(id);
      if (!taskId) continue;
      result.skipped.push({
        id: taskId,
        reason: code === 'parentTrashed' ? 'invalid' : 'notFound',
      });
    }
    return result;
  }
}
