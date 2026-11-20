import type { CanvasStorageItem } from '@lobechat/types';
import { formatSize } from '@lobechat/utils/format';
import { confirmModal, toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { swrKeys } from '@/libs/swr/keys';
import { canvasService } from '@/services/canvas';
import { workService } from '@/services/work';
import { workActions } from '@/store/work';

export const useFetchCanvasStorage = (enabled = true) =>
  useClientDataSWR(enabled ? swrKeys.canvas.storage() : null, () => canvasService.listStorage());

export const refreshCanvasStorage = () => mutate(swrKeys.canvas.storage());

export interface CanvasStorageSummary {
  /** Canvases that still have their Work, by canvas id. */
  byCanvas: Map<string, CanvasStorageItem>;
  canvasCount: number;
  canvasSize: number;
  /** Files whose canvas Work is gone: still counted, freed only by a cleanup. */
  orphans: CanvasStorageItem[];
  orphanSize: number;
}

/** Split the caller's canvas usage into named canvases and leftover files. */
export const summarizeCanvasStorage = (
  items: CanvasStorageItem[] | undefined,
): CanvasStorageSummary => {
  const byCanvas = new Map<string, CanvasStorageItem>();
  const orphans: CanvasStorageItem[] = [];
  for (const item of items ?? []) {
    if (item.workId) byCanvas.set(item.canvasId, item);
    else orphans.push(item);
  }
  const total = (list: Iterable<CanvasStorageItem>) =>
    [...list].reduce((sum, item) => sum + item.totalSize, 0);

  return {
    byCanvas,
    canvasCount: byCanvas.size,
    canvasSize: total(byCanvas.values()),
    orphanSize: total(orphans),
    orphans,
  };
};

export interface DeletableCanvas {
  canvasId: string;
  /** The public link the canvas is published at, taken offline by the delete. */
  publishedUrl?: string | null;
  title: string;
  /** Bytes freed, when known; the confirmation names it. */
  totalSize?: number;
  /** The canvas Work, when the caller knows it, dropped from every Work list at once. */
  workId?: string;
}

export interface UseDeleteCanvasOptions {
  /** Runs after the canvas is deleted, for lists outside the Work and storage caches. */
  onDeleted?: () => unknown;
}

const afterCanvasDelete = async (workIds: string[]) => {
  for (const workId of workIds) workActions.removeWork(workId);
  await refreshCanvasStorage();
  // The canvas card may also sit in the conversation it came from.
  void workService.refreshAllConversations();
};

/**
 * Confirm, then delete a whole canvas (every version and file) to free the
 * storage it holds and take any public link offline. Canvas files are never
 * deleted one at a time: a canvas only renders with all of its files.
 */
export const useDeleteCanvas = ({ onDeleted }: UseDeleteCanvasOptions = {}) => {
  const { t } = useTranslation(['file', 'common']);

  return useCallback(
    (canvas: DeletableCanvas) => {
      const size = canvas.totalSize ? formatSize(canvas.totalSize) : undefined;
      const content = [
        size
          ? t('canvasStorage.delete.content', { size, title: canvas.title })
          : t('canvasStorage.delete.contentNoSize', { title: canvas.title }),
        canvas.publishedUrl ? t('canvasStorage.delete.published') : undefined,
      ]
        .filter(Boolean)
        .join(' ');

      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content,
        okButtonProps: { danger: true },
        okText: t('delete', { ns: 'common' }),
        onOk: async () => {
          try {
            await canvasService.delete(canvas.canvasId);
            await afterCanvasDelete(canvas.workId ? [canvas.workId] : []);
            await onDeleted?.();
            toast.success(
              size
                ? t('canvasStorage.delete.success', { size })
                : t('canvasStorage.delete.successNoSize'),
            );
          } catch (error) {
            console.error('[useDeleteCanvas] failed to delete canvas', error);
            toast.error(t('operationFailed', { ns: 'common' }));
          }
        },
        title: t('canvasStorage.delete.title'),
      });
    },
    [onDeleted, t],
  );
};

/** Confirm, then free files left behind by canvases whose Work no longer exists. */
export const useCleanOrphanCanvasFiles = () => {
  const { t } = useTranslation(['file', 'common']);

  return useCallback(
    (orphans: CanvasStorageItem[]) => {
      const total = (list: CanvasStorageItem[]) =>
        list.reduce((sum, item) => sum + item.totalSize, 0);
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('canvasStorage.orphan.confirm', { size: formatSize(total(orphans)) }),
        okButtonProps: { danger: true },
        okText: t('delete', { ns: 'common' }),
        onOk: async () => {
          try {
            // Orphan-only: a canvas whose Work appeared since the list loaded
            // (its files land just before its Work) is skipped, not deleted.
            const freed: CanvasStorageItem[] = [];
            for (const orphan of orphans) {
              const result = await canvasService.delete(orphan.canvasId, {
                orphanOnly: true,
              });
              // A server predating the result always deletes.
              if (result?.deleted !== false) freed.push(orphan);
            }
            await afterCanvasDelete([]);
            toast.success(t('canvasStorage.orphan.success', { size: formatSize(total(freed)) }));
          } catch (error) {
            console.error('[useCleanOrphanCanvasFiles] failed to delete canvas files', error);
            await refreshCanvasStorage();
            toast.error(t('operationFailed', { ns: 'common' }));
          }
        },
        title: t('canvasStorage.orphan.title'),
      });
    },
    [t],
  );
};
