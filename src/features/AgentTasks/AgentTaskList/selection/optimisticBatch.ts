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

/**
 * How the list shows a batch action before the server answers — the same
 * change the server is about to make to each row:
 * - status / fields: patched in place (a status board moves the card);
 * - delete: the row leaves every collection;
 * - archive: the row leaves collections that hide archived rows, and is
 *   marked archived where "Show archived" keeps it; restore clears the mark.
 */
export const optimisticTaskPatch = (action: TaskBatchAction): CollectionTasksPatch => {
  switch (action.kind) {
    case 'delete': {
      return () => undefined;
    }
    case 'archive': {
      if (!action.archived) return (task) => ({ ...task, archivedAt: null });
      const archivedAt = new Date();
      return (task, query) => (query.includeArchived ? { ...task, archivedAt } : undefined);
    }
    case 'status': {
      return (task) => ({ ...task, status: action.status });
    }
    case 'update': {
      const { patch } = action;
      return (task) => ({
        ...task,
        ...(patch.assigneeAgentId !== undefined && { assigneeAgentId: patch.assigneeAgentId }),
        ...(patch.assigneeUserId !== undefined && { assigneeUserId: patch.assigneeUserId }),
        ...(patch.priority !== undefined && { priority: patch.priority }),
      });
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
