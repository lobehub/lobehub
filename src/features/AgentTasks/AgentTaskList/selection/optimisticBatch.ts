import type { CollectionTasksPatch } from '@/store/task/slices/list/action';
import type { CollectionTask } from '@/store/task/slices/list/projection';

import type { TaskBatchOutcome } from './taskSelectionModel';

export type TaskBatchStatus = 'backlog' | 'canceled' | 'completed' | 'paused';

export type TaskBatchAction =
  | { archived: boolean; kind: 'archive' }
  | { kind: 'delete' }
  | { kind: 'status'; status: TaskBatchStatus }
  | {
      kind: 'update';
      patch: { assigneeAgentId?: string | null; assigneeUserId?: string | null; priority?: number };
    };

/** A changed row as `batchUpdate` / `batchUpdateStatus` return it (list-visible columns). */
export type TaskBatchChangedRow = Partial<CollectionTask> & { id: string };

export type TaskBatchResponse = TaskBatchOutcome & { tasks?: TaskBatchChangedRow[] };

/** Statuses the server stamps `completedAt` on (`TaskBatchService.updateStatus`). */
const TERMINAL_STATUSES = new Set<TaskBatchStatus>(['canceled', 'completed']);

/**
 * How the list shows a batch action before the server answers — the same
 * change the server is about to make to each row:
 * - status: patched in place (a status board moves the card); closing a task
 *   stamps `completedAt` / `updatedAt` now, as the server will, so a
 *   "completed within" window does not date it by its stale `updatedAt`;
 * - fields: patched in place; a reassigned row leaves a collection scoped to
 *   its old assignee (an agent's tasks, "My tasks: assigned");
 * - delete: the row leaves every collection;
 * - archive: the row leaves collections that hide archived rows, and is
 *   marked archived where "Show archived" keeps it; restore clears the mark.
 *   A collection whose query is unknown (a persisted, unloaded row) is left
 *   as stored: guessing would drop the row from a "Show archived" view.
 */
export const optimisticTaskPatch = (action: TaskBatchAction): CollectionTasksPatch => {
  switch (action.kind) {
    case 'delete': {
      return () => undefined;
    }
    case 'archive': {
      if (!action.archived) return (task) => ({ ...task, archivedAt: null });
      const archivedAt = new Date();
      return (task, query) => {
        if (query.includeArchived === undefined) return task;
        return query.includeArchived ? { ...task, archivedAt } : undefined;
      };
    }
    case 'status': {
      const now = new Date();
      const closes = TERMINAL_STATUSES.has(action.status);
      return (task) => ({
        ...task,
        status: action.status,
        updatedAt: now,
        ...(closes && { completedAt: now }),
      });
    }
    case 'update': {
      const { patch } = action;
      return (task, query) => {
        // The row leaves a collection scoped to the assignee it no longer has.
        if (
          query.agentId &&
          patch.assigneeAgentId !== undefined &&
          patch.assigneeAgentId !== query.agentId
        )
          return undefined;
        if (
          query.scope === 'assigned' &&
          patch.assigneeUserId !== undefined &&
          patch.assigneeUserId !== task.assigneeUserId
        )
          return undefined;
        return {
          ...task,
          ...(patch.assigneeAgentId !== undefined && { assigneeAgentId: patch.assigneeAgentId }),
          ...(patch.assigneeUserId !== undefined && { assigneeUserId: patch.assigneeUserId }),
          ...(patch.priority !== undefined && { priority: patch.priority }),
        };
      };
    }
  }
};

/**
 * The patches to keep once the server answered: only the rows it changed.
 * Failed and skipped rows are left out, so they fall back to what they were.
 * A changed row the server sent back is confirmed with its values (e.g. the
 * `completedAt` it stamped), on top of the optimistic patch.
 */
export const confirmedTaskPatches = (
  patch: CollectionTasksPatch,
  updated: readonly string[],
  rows: readonly TaskBatchChangedRow[] = [],
): Map<string, CollectionTasksPatch> => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return new Map(
    updated.map((id) => {
      const row = byId.get(id);
      if (!row) return [id, patch] as const;
      const confirmed: CollectionTasksPatch = (task, query) => {
        const next = patch(task, query);
        return next && ({ ...next, ...row } as CollectionTask);
      };
      return [id, confirmed] as const;
    }),
  );
};
