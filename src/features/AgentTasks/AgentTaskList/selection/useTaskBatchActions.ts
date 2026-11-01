import { toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { taskService } from '@/services/task';
import { useTaskStore } from '@/store/task';

import { useTaskSelectionStore } from './store';
import { chunkIds, mergeOutcomes, type TaskBatchOutcome } from './taskSelectionModel';

export type TaskBatchStatus = 'backlog' | 'canceled' | 'completed' | 'paused';

export type TaskBatchAction =
  | { archived: boolean; kind: 'archive' }
  | { kind: 'delete' }
  | { kind: 'status'; status: TaskBatchStatus }
  | {
      kind: 'update';
      patch: { assigneeAgentId?: string | null; assigneeUserId?: string | null; priority?: number };
    };

const runChunk = (action: TaskBatchAction, ids: string[]): Promise<TaskBatchOutcome> => {
  switch (action.kind) {
    case 'archive': {
      return taskService.batchArchive(ids, action.archived);
    }
    case 'delete': {
      return taskService.batchDelete(ids);
    }
    case 'status': {
      return taskService.batchUpdateStatus(ids, action.status);
    }
    case 'update': {
      return taskService.batchUpdate({ ids, ...action.patch });
    }
  }
};

/**
 * Apply one action to the current selection: one request per 500 tasks (the
 * server's batch limit), then a single list refresh and a single summary
 * toast. Tasks that failed stay selected so the user can retry them.
 */
export const useTaskBatchActions = () => {
  const { t } = useTranslation('chat');
  const refreshTaskList = useTaskStore((s) => s.refreshTaskList);
  const running = useTaskSelectionStore((s) => !!s.progress);

  const run = useCallback(
    async (action: TaskBatchAction) => {
      const { generation, progress, selectedIds } = useTaskSelectionStore.getState();
      // Progress belongs to the selection this batch started from; once that
      // is cleared (list left, Esc) later updates must not reach the new list.
      const setProgress = (next?: { done: number; total: number }) => {
        const store = useTaskSelectionStore.getState();
        if (store.generation === generation) store.setProgress(next);
      };
      // One batch at a time: a second action must not race the first.
      if (progress) return;
      const ids = [...selectedIds];
      if (ids.length === 0) return;

      setProgress({ done: 0, total: ids.length });
      const outcomes: TaskBatchOutcome[] = [];
      let requestError: unknown;
      try {
        // Sequential: each chunk is already a set-based write on the server,
        // and ordering keeps a later chunk from racing an earlier one.
        let done = 0;
        for (const chunk of chunkIds(ids)) {
          outcomes.push(await runChunk(action, chunk));
          done += chunk.length;
          setProgress({ done, total: ids.length });
        }
      } catch (error) {
        requestError = error;
      }
      // The batch is committed whatever happens here; a failed refresh only
      // means the list on screen is stale, so say that (with a retry) instead
      // of hiding it behind the success toast.
      await refreshTaskList().catch((error: unknown) => {
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
      setProgress(undefined);

      const { failed, followUpFailed, skipped, updated } = mergeOutcomes(outcomes);
      const unprocessed = ids.length - updated.length - skipped.length - failed.length;
      const failedCount = failed.length + Math.max(unprocessed, 0);

      if (requestError && updated.length === 0) {
        toast.error(
          requestError instanceof Error && requestError.message
            ? requestError.message
            : t('taskList.bulk.result.error'),
        );
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

      const selection = useTaskSelectionStore.getState();
      // The list this batch started from was left (or its selection cleared)
      // while the requests ran: its ids mean nothing to the list on screen now,
      // so neither restore them nor clear the new list's own selection.
      if (selection.generation !== generation) return;
      if (failedCount > 0) {
        // Keep exactly what still needs attention selected.
        // Only rows the list on screen still shows: after a page or scope change
        // the old ids are not visible, and must not come back selected.
        const done = new Set([...updated, ...skipped.map((item) => item.id)]);
        useTaskSelectionStore.setState({
          panelOpen: false,
          selectedIds: ids.filter((id) => !done.has(id) && selection.visibleIds.has(id)),
        });
      } else {
        selection.clear();
      }
    },
    [refreshTaskList, t],
  );

  return { run, running };
};
