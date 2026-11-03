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
import { useTaskSelectionStore } from './store';
import { chunkIds, mergeOutcomes } from './taskSelectionModel';

export type { TaskBatchAction, TaskBatchStatus } from './optimisticBatch';

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
 * Batches reach the server in click order. The list already shows each one,
 * so a second action never waits on screen — but two writes to the same rows
 * must land in the order the user made them, or the list would settle on the
 * earlier one.
 */
let serverQueue: Promise<unknown> = Promise.resolve();
const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
  const next = serverQueue.then(job, job);
  serverQueue = next.catch(() => undefined);
  return next;
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
  const refreshTaskList = useTaskStore((s) => s.refreshTaskList);
  const beginOptimistic = useTaskStore((s) => s.internal_beginCollectionTasksOptimistic);
  const running = useTaskSelectionStore((s) => !!s.progress);

  const refreshInBackground = useCallback(() => {
    // The batch is committed whatever happens here; a failed refresh only
    // means the list on screen may be stale, so say that (with a retry).
    void refreshTaskList().catch((error: unknown) => {
      console.error('[task batch] list refresh failed after a committed batch', error);
      const retry = () => {
        void refreshTaskList().catch((retryError: unknown) => {
          console.error('[task batch] list refresh retry failed', retryError);
        });
      };
      toast.warning({
        actions: [{ label: t('taskList.bulk.refreshFailed.retry'), onClick: retry }],
        description: t('taskList.bulk.refreshFailed.desc'),
        title: t('taskList.bulk.refreshFailed.title'),
      });
    });
  }, [refreshTaskList, t]);

  const run = useCallback(
    async (action: TaskBatchAction) => {
      const { selectedIds, visibleIds: shownAtStart } = useTaskSelectionStore.getState();
      const ids = [...selectedIds];
      if (ids.length === 0) return;

      const patch = optimisticTaskPatch(action);
      const overlay = beginOptimistic(ids, patch);
      // The rows already show the result: the selection is done with.
      useTaskSelectionStore.getState().clear();
      const generation = useTaskSelectionStore.getState().generation;

      const outcomes: TaskBatchResponse[] = [];
      let requestError: unknown;
      await enqueue(async () => {
        try {
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
      // moved on (selected something else, or left the list: a scope or page
      // change clears the selection), and only rows the list on screen shows.
      // A row the overlay took out (delete, archive) is back in the list now
      // but not yet in `visibleIds`; the list's next prune checks it again.
      const removesRows = action.kind === 'delete' || action.kind === 'archive';
      const restoreSelection = (pending: readonly string[]) => {
        const selection = useTaskSelectionStore.getState();
        if (selection.generation !== generation || selection.selectedIds.length > 0) return;
        const restored = pending.filter(
          (id) => selection.visibleIds.has(id) || (removesRows && shownAtStart.has(id)),
        );
        if (restored.length > 0) useTaskSelectionStore.setState({ selectedIds: restored });
      };

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
      const message = parts.join(' · ');
      if (failedCount > 0) toast.warning(message);
      else toast.success(message);

      if (failedCount > 0) {
        const done = new Set([...updated, ...skipped.map((item) => item.id)]);
        restoreSelection(ids.filter((id) => !done.has(id)));
      }
    },
    [beginOptimistic, refreshInBackground, t],
  );

  return { run, running };
};
