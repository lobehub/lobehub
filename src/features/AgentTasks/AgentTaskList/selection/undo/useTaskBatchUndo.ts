import { toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { taskService } from '@/services/task';
import { useTaskStore } from '@/store/task';

import {
  confirmedTaskPatches,
  optimisticUndoPatch,
  type TaskBatchResponse,
} from '../optimisticBatch';
import { enqueueBatchRequest } from '../serverQueue';
import { useTaskSelectionStore } from '../store';
import { chunkIds, mergeOutcomes, TASK_BATCH_CHUNK_SIZE } from '../taskSelectionModel';
import { useBackgroundTaskListRefresh } from '../useBackgroundTaskListRefresh';
import { peekLastUndoEntry, takeUndoEntry, type TaskBatchUndoEntry } from './stack';

const chunk = <T>(items: readonly T[]): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += TASK_BATCH_CHUNK_SIZE)
    chunks.push(items.slice(i, i + TASK_BATCH_CHUNK_SIZE));
  return chunks;
};

/**
 * Undo of a committed batch, as fast as the batch itself: status and field
 * changes show their old values at once (each task its own `before`), the
 * request runs behind it in click order, and the list refresh follows in the
 * background. Tasks someone changed again since the batch are left alone and
 * counted in the toast. The undone tasks come back selected (like Linear),
 * unless the user has moved on to another selection.
 */
export const useTaskBatchUndo = () => {
  const { t } = useTranslation('chat');
  const beginOptimistic = useTaskStore((s) => s.internal_beginCollectionTasksOptimistic);
  const refreshInBackground = useBackgroundTaskListRefresh();

  const undo = useCallback(
    async (entry: TaskBatchUndoEntry) => {
      // At most once: the toast button and ⌘Z can both reach the same entry.
      if (!takeUndoEntry(entry.id)) return;
      const revision = useTaskSelectionStore.getState().revision;

      const ids = entry.kind === 'revert' ? entry.reverts.map((r) => r.id) : entry.taskIds;
      const patch = entry.kind === 'revert' ? optimisticUndoPatch(entry.reverts) : undefined;
      // A restore from the bin has no rows on screen to patch; the refresh brings them.
      const overlay = patch ? beginOptimistic(ids, patch) : undefined;

      const outcomes: TaskBatchResponse[] = [];
      let requestError: unknown;
      await enqueueBatchRequest(async () => {
        try {
          if (entry.kind === 'revert') {
            for (const part of chunk(entry.reverts))
              outcomes.push(await taskService.batchRevert(part));
          } else {
            for (const part of chunkIds(entry.taskIds))
              outcomes.push(await taskService.batchRestoreDeleted(part));
          }
        } catch (error) {
          requestError = error;
        }
      });

      const { failed, skipped, updated } = mergeOutcomes(outcomes);
      if (overlay && patch) {
        if (updated.length === 0) overlay.rollback();
        else overlay.commit(confirmedTaskPatches(patch, updated));
      }
      if (updated.length > 0) refreshInBackground();

      if (requestError && updated.length === 0) {
        toast.error(
          requestError instanceof Error && requestError.message
            ? requestError.message
            : t('taskList.bulk.undo.error'),
        );
        return;
      }

      const conflicts = skipped.filter((item) => item.reason === 'conflict').length;
      const otherSkipped = skipped.length - conflicts;
      const unprocessed = Math.max(ids.length - updated.length - skipped.length - failed.length, 0);
      const parts = [t('taskList.bulk.undo.done', { count: updated.length })];
      if (conflicts > 0) parts.push(t('taskList.bulk.undo.conflict', { count: conflicts }));
      if (otherSkipped > 0) parts.push(t('taskList.bulk.result.skipped', { count: otherSkipped }));
      if (failed.length + unprocessed > 0)
        parts.push(t('taskList.bulk.result.failed', { count: failed.length + unprocessed }));
      const message = parts.join(' · ');
      if (updated.length < ids.length) toast.warning(message);
      else toast.success(message);

      // Like Linear: the undone tasks come back selected — once the list
      // renders them (a restore from the bin needs the refresh first).
      if (updated.length > 0) useTaskSelectionStore.getState().restore(updated, revision);
    },
    [beginOptimistic, refreshInBackground, t],
  );

  /** ⌘/Ctrl+Z: undo the most recent batch still on the stack. */
  const undoLast = useCallback(() => {
    const entry = peekLastUndoEntry();
    if (!entry) return false;
    void undo(entry);
    return true;
  }, [undo]);

  return { undo, undoLast };
};
