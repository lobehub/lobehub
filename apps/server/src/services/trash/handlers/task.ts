import type { TaskItem } from '@lobechat/types';

import { TaskModel } from '@/database/models/task';
import { TopicModel } from '@/database/models/topic';
import type { TrashRegisterEntry } from '@/database/models/trash';
import type { SoftDeleteOptions } from '@/database/utils/softDelete';

import { topicEntry } from './topic';
import {
  type TrashCascade,
  type TrashHandler,
  type TrashHandlerContext,
  TrashRestoreError,
} from './types';

export const taskEntry = (task: TaskItem, childCount: number): TrashRegisterEntry => ({
  // `kind` carries the identifier so the bin can show "T-12 · name".
  meta: { childCount, kind: task.identifier },
  projectId: task.projectId ?? null,
  resourceId: task.id,
  resourceType: 'task',
  title: task.name || task.identifier,
});

export interface TaskTrashTarget {
  /** The status the caller decided on; a task that moved on since is left alone. */
  status: string;
  taskId: string;
  /** Topics linked to the task, as read under the caller's row lock. */
  topicIds: string[];
}

/**
 * Trash tasks with the cascade the hard delete had: each task's linked topics
 * (which have no FK back to the task and would otherwise linger in the
 * sidebar) go into the bin with it, registered as its children so a restore
 * brings the conversations back too. Subtasks are not cascaded — they stay
 * live and list as top-level rows while the parent is in the bin.
 *
 * Runs inside the caller's transaction, after it has taken the tasks' row
 * locks, so no run can record a topic between the snapshot and the stamp.
 * Returns one cascade per task actually stamped (the status CAS held).
 */
export const softDeleteTasks = async (
  ctx: Pick<TrashHandlerContext, 'db' | 'userId' | 'workspaceId'>,
  targets: TaskTrashTarget[],
  options: SoftDeleteOptions,
): Promise<TrashCascade[]> => {
  if (targets.length === 0) return [];
  const stamped = await new TaskModel(ctx.db, ctx.userId, ctx.workspaceId).softDeleteIfStatusForIds(
    targets.map(({ status, taskId }) => ({ id: taskId, status })),
    options,
  );
  if (stamped.length === 0) return [];

  const topicIdsByTask = new Map(targets.map((target) => [target.taskId, target.topicIds]));
  // A topic already in the bin keeps its own root (`softDelete` skips it).
  const topics = await new TopicModel(ctx.db, ctx.userId, ctx.workspaceId).softDelete(
    stamped.flatMap((task) => topicIdsByTask.get(task.id) ?? []),
    { deletedAt: options.deletedAt },
  );
  const topicsById = new Map(topics.map((topic) => [topic.id, topic]));

  return stamped.map((task) => {
    const children = (topicIdsByTask.get(task.id) ?? [])
      .map((id) => topicsById.get(id))
      .filter((topic) => !!topic)
      .map((topic) => topicEntry(topic));
    return { children, root: taskEntry(task, children.length) };
  });
};

export const taskHandler: TrashHandler = {
  /**
   * One transaction: the task row and its registered topics go together, and
   * a restore that won the race (nothing left stamped) keeps both.
   */
  purge: async (ctx, root, children) => {
    await ctx.db.transaction(async (tx) => {
      const db = tx as unknown as typeof ctx.db;
      // FK cascades take dependencies, comments, documents and `task_topics`;
      // subtasks get `parent_task_id = NULL`, as the hard delete always did.
      const purged = await new TaskModel(db, ctx.userId, ctx.workspaceId).purge([root.resourceId]);
      if (purged.length === 0) return;

      const topicIds = children
        .filter((child) => child.resourceType === 'topic')
        .map((child) => child.resourceId);
      if (topicIds.length > 0) {
        await new TopicModel(db, ctx.userId, ctx.workspaceId).batchDeleteIncludingTrashed(topicIds);
      }
    });
  },
  restore: async (ctx, root, children) => {
    const taskModel = new TaskModel(ctx.db, ctx.userId, ctx.workspaceId);
    const [task] = await taskModel.findTrashedByIds([root.resourceId]);
    if (!task) throw new TrashRestoreError('notFound');

    // A subtask whose parent is itself in the bin would come back under an
    // invisible parent: restore the parent first.
    if (task.parentTaskId && (await taskModel.findTrashedIds([task.parentTaskId])).length > 0) {
      throw new TrashRestoreError('parentTrashed');
    }

    // Only a row this update actually brought back counts (a purge may have
    // won between the read above and here).
    const restored = await taskModel.restore([root.resourceId]);
    if (restored.length === 0) throw new TrashRestoreError('notFound');

    const topicIds = children
      .filter((child) => child.resourceType === 'topic')
      .map((child) => child.resourceId);
    await new TopicModel(ctx.db, ctx.userId, ctx.workspaceId).restore(topicIds);
  },
  type: 'task',
};
