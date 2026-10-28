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

export const useFetchCanvasStorage = () =>
  useClientDataSWR(swrKeys.canvas.storage(), () => canvasService.listStorage());

export const refreshCanvasStorage = () => mutate(swrKeys.canvas.storage());

/** What the drive entry names, or `null` when canvases hold no storage. */
export const summarizeCanvasStorage = (items: CanvasStorageItem[] | undefined) => {
  const totalSize = items?.reduce((sum, item) => sum + item.totalSize, 0) ?? 0;
  return items?.length && totalSize > 0 ? { count: items.length, totalSize } : null;
};

/**
 * Confirm, then delete a whole canvas (every version and file) to free the
 * storage it holds. Canvas files are never deleted one at a time: a canvas
 * only renders with all of its files.
 */
export const useDeleteCanvas = () => {
  const { t } = useTranslation(['file', 'common']);

  return useCallback(
    (item: CanvasStorageItem) => {
      const size = formatSize(item.totalSize);
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t('canvasStorage.delete.content', {
          size,
          title: item.title || t('canvasStorage.item.untitled'),
        }),
        okButtonProps: { danger: true },
        okText: t('delete', { ns: 'common' }),
        onOk: async () => {
          try {
            await canvasService.delete(item.canvasId);
            if (item.workId) workActions.removeWork(item.workId);
            await refreshCanvasStorage();
            toast.success(t('canvasStorage.delete.success', { size }));
            // The canvas card may also sit in the Works gallery and in the
            // conversation it came from.
            void workService.refreshAllConversations();
          } catch (error) {
            console.error('[useDeleteCanvas] failed to delete canvas', error);
            toast.error(t('operationFailed', { ns: 'common' }));
          }
        },
        title: t('canvasStorage.delete.title'),
      });
    },
    [t],
  );
};
