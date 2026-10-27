import type { NewTask } from '@lobechat/types';
import { withoutTaskExecutionSelection } from '@lobechat/types';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import {
  taskActivities,
  taskComments,
  taskDependencies,
  taskDocuments,
  tasks,
} from '../../schemas/task';
import type { LobeChatDatabase } from '../../type';
import { type CheckpointTaskRelocation, remapCheckpointConfig } from './checkpoint';
import type { TaskModelContext } from './context';
import { collectTaskSubtree } from './tree';
import { DEFAULT_TASK_IDENTIFIER_PREFIX } from './utils';

/**
 * Allocate a contiguous block of seq numbers + identifiers in the target
 * scope. Returns the next available seq baseline.
 */
export const nextSeqIn = async (
  runner: LobeChatDatabase,
  targetWorkspaceId: string | null,
  targetUserId: string,
): Promise<number> => {
  const where = targetWorkspaceId
    ? eq(tasks.workspaceId, targetWorkspaceId)
    : and(eq(tasks.createdByUserId, targetUserId), isNull(tasks.workspaceId));
  const [{ maxSeq }] = await runner
    .select({ maxSeq: sql<number>`COALESCE(MAX(${tasks.seq}), 0)` })
    .from(tasks)
    .where(where!);
  return Number(maxSeq) + 1;
};

/**
 * Transfer a task subtree to another workspace / personal scope. Reallocates
 * `identifier`/`seq` in the target scope and rewrites the child tables that
 * mirror the parent's ownership (`task_dependencies`, `task_documents`,
 * `task_comments`, `task_activities`) so the ownership predicates keep
 * resolving after the move — those mirrored columns are what authorizes
 * reads, so a child left behind goes invisible in the destination scope.
 *
 * NOTE: `task_topics` and `briefs` carry the same mirrored columns but are
 * not rewritten here. Pre-existing gap, called out rather than widened.
 *
 * Cross-scope references that may no longer be valid are cleared:
 *   - `assigneeAgentId` (workspace move: agent likely doesn't exist there)
 *   - `currentTopicId` (topic ownership is also moving but the link is
 *     reset to avoid surfacing a stale active topic in the new scope)
 */
export const transferTo = async (
  ctx: TaskModelContext,
  taskId: string,
  targetWorkspaceId: string | null,
  targetUserId: string,
  targetVisibility?: 'private' | 'public',
): Promise<{ taskIds: string[] }> => {
  return ctx.db.transaction(async (trx) => {
    const subtree = await collectTaskSubtree(ctx, taskId, trx as LobeChatDatabase);
    if (subtree.length === 0) throw new Error('Task not found');

    const ids = subtree.map((t) => t.id);

    // Visibility only applies when landing in a workspace. In personal scope
    // every row is implicitly private and the field is ignored.
    const visibilityUpdate =
      targetWorkspaceId && targetVisibility ? { visibility: targetVisibility } : {};

    // Reallocate identifier + seq in target scope to avoid collisions.
    const baseSeq = await nextSeqIn(trx as LobeChatDatabase, targetWorkspaceId, targetUserId);
    const relocations = subtree.map((task, index) => ({
      source: task,
      target: { id: task.id, identifier: `T-${baseSeq + index}` },
    }));
    // Update each task individually because identifier/seq are per-row.
    for (const [idx, task] of subtree.entries()) {
      const seq = baseSeq + idx;
      const identifier = `T-${seq}`;
      await (trx as LobeChatDatabase)
        .update(tasks)
        .set({
          // Clear cross-scope refs: agent / topic may be invalid in new scope.
          assigneeAgentId: targetWorkspaceId === ctx.workspaceId ? task.assigneeAgentId : null,
          createdByUserId: targetUserId,
          config: remapCheckpointConfig(task.config, relocations),
          currentTopicId: null,
          identifier,
          seq,
          updatedAt: new Date(),
          workspaceId: targetWorkspaceId,
          ...visibilityUpdate,
        })
        .where(eq(tasks.id, task.id));
    }

    // Update child tables that key off taskId. Child rows mirror the parent
    // task's visibility (see schema comments on task_deps / task_docs /
    // task_comments) so cascade the new visibility here too.
    const ownershipUpdate = { userId: targetUserId, workspaceId: targetWorkspaceId };
    await (trx as LobeChatDatabase)
      .update(taskDependencies)
      .set({ ...ownershipUpdate, ...visibilityUpdate })
      .where(inArray(taskDependencies.taskId, ids));
    await (trx as LobeChatDatabase)
      .update(taskDocuments)
      .set({ ...ownershipUpdate, ...visibilityUpdate })
      .where(inArray(taskDocuments.taskId, ids));
    await (trx as LobeChatDatabase)
      .update(taskComments)
      .set({ ...ownershipUpdate, ...visibilityUpdate })
      .where(inArray(taskComments.taskId, ids));
    await (trx as LobeChatDatabase)
      .update(taskActivities)
      .set({ ...ownershipUpdate, ...visibilityUpdate })
      .where(inArray(taskActivities.taskId, ids));

    return { taskIds: ids };
  });
};

/**
 * Deep clone a task subtree into another workspace / personal scope. Fresh
 * ids, fresh identifiers, preserved parent/child topology. Cross-scope refs
 * (agent / topic / brief / current topic) are cleared on the clones so the
 * copies start clean in the new scope.
 */
export const copyToWorkspace = async (
  ctx: TaskModelContext,
  taskId: string,
  targetWorkspaceId: string | null,
  targetUserId: string,
  targetVisibility?: 'private' | 'public',
): Promise<{ rootId: string }> => {
  return ctx.db.transaction(async (trx) => {
    const subtree = await collectTaskSubtree(ctx, taskId, trx as LobeChatDatabase);
    if (subtree.length === 0) throw new Error('Task not found');

    // Visibility only applies when landing in a workspace.
    const visibilityOverride =
      targetWorkspaceId && targetVisibility ? { visibility: targetVisibility } : {};

    // BFS clone — parent inserted before children, so we always know the
    // new parentTaskId by the time we reach the child.
    const idMap = new Map<string, string>();
    const relocations: CheckpointTaskRelocation[] = [];
    const byId = new Map(subtree.map((t) => [t.id, t]));
    const queue: string[] = [taskId];
    const seen = new Set<string>();

    let seq = await nextSeqIn(trx as LobeChatDatabase, targetWorkspaceId, targetUserId);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (seen.has(currentId)) continue;
      seen.add(currentId);
      const original = byId.get(currentId);
      if (!original) continue;

      const newParentId = currentId === taskId ? null : (idMap.get(original.parentTaskId!) ?? null);

      const identifier = `${DEFAULT_TASK_IDENTIFIER_PREFIX}-${seq}`;
      const inserted = (await (trx as LobeChatDatabase)
        .insert(tasks)
        .values({
          assigneeAgentId: null,
          assigneeUserId: null,
          automationMode: original.automationMode,
          // The run location is dropped the way the other cross-scope refs
          // are: a pinned machine, a path on it and a repo set all name
          // something in the scope this task came from, and the clone's first
          // assignment cannot clean them up later (it has no previous assignee
          // to diff against — see `updateWithLog`).
          config: withoutTaskExecutionSelection(original.config as null | Record<string, unknown>),
          context: {
            ...(original.context as Record<string, unknown>),
            duplicatedFrom: original.id,
          },
          createdByAgentId: null,
          createdByUserId: targetUserId,
          currentTopicId: null,
          description: original.description,
          error: null,
          heartbeatInterval: original.heartbeatInterval,
          heartbeatTimeout: original.heartbeatTimeout,
          identifier,
          instruction: original.instruction,
          maxTopics: original.maxTopics,
          name: original.name,
          parentTaskId: newParentId,
          priority: original.priority,
          schedulePattern: original.schedulePattern,
          scheduleTimezone: original.scheduleTimezone,
          seq,
          sortOrder: original.sortOrder,
          // Reset lifecycle: copy starts fresh, not mid-run.
          status: 'backlog',
          totalTopics: 0,
          workspaceId: targetWorkspaceId,
          ...visibilityOverride,
        } as NewTask)
        .returning({ id: tasks.id, identifier: tasks.identifier })) as {
        id: string;
        identifier: string;
      }[];

      idMap.set(original.id, inserted[0]!.id);
      relocations.push({ source: original, target: inserted[0]! });
      seq++;

      for (const c of subtree) {
        if (c.parentTaskId === original.id) queue.push(c.id);
      }
    }

    for (const original of subtree) {
      await (trx as LobeChatDatabase)
        .update(tasks)
        .set({
          config: remapCheckpointConfig(
            withoutTaskExecutionSelection(original.config as Record<string, unknown> | null),
            relocations,
          ),
        })
        .where(eq(tasks.id, idMap.get(original.id)!));
    }
    return { rootId: idMap.get(taskId)! };
  });
};
