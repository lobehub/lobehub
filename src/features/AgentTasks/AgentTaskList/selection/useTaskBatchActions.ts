import { toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { taskService } from '@/services/task';
import { useTaskStore } from '@/store/task';

import {
  confirmedTaskPatches,
  optimisticTaskPatch,
  type TaskBatchAction,
  type TaskBatchChangedRow,
  type TaskBatchResponse,
} from './optimisticBatch';
import { enqueueBatchRequest } from './serverQueue';
import { useTaskSelectionStore } from './store';
import { chunkIds, mergeOutcomes } from './taskSelectionModel';
import { pushUndoEntry } from './undo/stack';
import { useTaskBatchUndo } from './undo/useTaskBatchUndo';
import { useBackgroundTaskListRefresh } from './useBackgroundTaskListRefresh';

export type { TaskBatchAction, TaskBatchStatus } from './optimisticBatch';

export interface TaskBatchRunOptions {
  /**
   * Work the batch depends on, run in the request queue ahead of it (after the
   * optimistic overlay is up), e.g. making tasks private before a private
   * agent is assigned to them. It receives the selected ids.
   */
  prepare?: (ids: string[]) => Promise<unknown>;
}

const runChunk = (action: TaskBatchAction, ids: string[]): Promise<TaskBatchResponse> => {
  switch (action.kind) {
    case 'archive': {
      return taskService.batchArchive(ids, action.archived);
    }
    case 'delete': {
      return taskService.batchDelete(ids);
    }
    case 'status': {
      return taskService.batchUpdateStatus(ids, action.status) as Promise<TaskBatchResponse>;
    }
    case 'update': {
      return taskService.batchUpdate({ ids, ...action.patch }) as Promise<TaskBatchResponse>;
    }
  }
};

/**
 * Apply one action to the current selection, optimistically: every loaded
 * list and board shows the result and the selection clears the moment the
 * action is picked. The requests (one per 500 tasks, the server's batch
 * limit) run behind it; their answer settles the overlay — rows the server
 * did not change fall back and come back selected for a retry, a failed
 * request rolls everything back — and the list refresh that follows runs in
 * the background, never in front of the user.
 */
export const useTaskBatchActions = () => {
  const { t } = useTranslation('chat');
  const beginOptimistic = useTaskStore((s) => s.internal_beginCollectionTasksOptimistic);
  const running = useTaskSelectionStore((s) => !!s.progress);

  const refreshInBackground = useBackgroundTaskListRefresh();
  const { undo } = useTaskBatchUndo();

  const run = useCallback(
    async (action: TaskBatchAction, runOptions?: TaskBatchRunOptions) => {
      const ids = [...useTaskSelectionStore.getState().selectedIds];
      if (ids.length === 0) return;

      const patch = optimisticTaskPatch(action);
      const overlay = beginOptimistic(ids, patch);
      // The rows already show the result: the selection is done with.
      useTaskSelectionStore.getState().clear();
      const revision = useTaskSelectionStore.getState().revision;

      const outcomes: TaskBatchResponse[] = [];
      let requestError: unknown;
      await enqueueBatchRequest(async () => {
        try {
          await runOptions?.prepare?.(ids);
          // Sequential: each chunk is already a set-based write on the server,
          // and ordering keeps a later chunk from racing an earlier one.
          for (const chunk of chunkIds(ids)) outcomes.push(await runChunk(action, chunk));
        } catch (error) {
          requestError = error;
        }
      });

      const { failed, followUpFailed, skipped, updated } = mergeOutcomes(outcomes);
      const rows = outcomes.flatMap((outcome): TaskBatchChangedRow[] => outcome.tasks ?? []);
      const unprocessed = ids.length - updated.length - skipped.length - failed.length;
      const failedCount = failed.length + Math.max(unprocessed, 0);

      if (updated.length === 0) overlay.rollback();
      else {
        overlay.commit(confirmedTaskPatches(patch, updated, rows));
        refreshInBackground();
      }

      // Rows still needing attention come back selected — unless the user has
      // moved on: any selection change since the click (even one undone
      // since), or leaving the list (a scope or page change clears it). A row the overlay hid (deleted,
      // archived, or moved to a status the view hides) is only shown again
      // once the rollback renders; the store selects it on the list's next
      // prune, if the list then shows it.
      const restoreSelection = (pending: readonly string[]) =>
        useTaskSelectionStore.getState().restore(pending, revision);

      if (requestError && updated.length === 0) {
        toast.error(
          requestError instanceof Error && requestError.message
            ? requestError.message
            : t('taskList.bulk.result.error'),
        );
        restoreSelection(ids);
        return;
      }

      const parts = [
        t(
          action.kind === 'delete'
            ? 'taskList.bulk.result.deleted'
            : 'taskList.bulk.result.updated',
          { count: updated.length },
        ),
      ];
      if (skipped.length > 0)
        parts.push(t('taskList.bulk.result.skipped', { count: skipped.length }));
      if (failedCount > 0) parts.push(t('taskList.bulk.result.failed', { count: failedCount }));
      if (followUpFailed) {
        toast.warning({
          description: t('taskList.bulk.followUpFailed.desc'),
          title: t('taskList.bulk.followUpFailed.title'),
        });
      }
      // Whatever the batch changed can be undone — from the toast, or with
      // ⌘/Ctrl+Z while the list is on screen (also after the toast is gone).
      const reverts = outcomes.flatMap((outcome) => outcome.reverts ?? []);
      const undoEntry =
        updated.length === 0
          ? undefined
          : action.kind === 'delete'
            ? pushUndoEntry({ kind: 'restore', taskIds: updated })
            : reverts.length > 0
              ? pushUndoEntry({ kind: 'revert', reverts })
              : undefined;
      const message = parts.join(' · ');
      const options = {
        ...(undoEntry && {
          actions: [
            {
              label: t('taskList.bulk.undo.action'),
              onClick: () => void undo(undoEntry),
              variant: 'text' as const,
            },
          ],
          // Long enough to read the result and reach the button.
          duration: 8000,
        }),
        title: message,
      };
      if (failedCount > 0) toast.warning(options);
      else toast.success(options);

      if (failedCount > 0) {
        const done = new Set([...updated, ...skipped.map((item) => item.id)]);
        restoreSelection(ids.filter((id) => !done.has(id)));
      }
    },
    [beginOptimistic, refreshInBackground, t, undo],
  );

  return { run, running };
};
