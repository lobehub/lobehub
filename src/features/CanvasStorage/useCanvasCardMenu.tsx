import type { CanvasStorageItem, WorkSummaryItem } from '@lobechat/types';
import { copyToClipboard, type DropdownItem, toast } from '@lobehub/ui';
import { LinkIcon, Trash2Icon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { useDeleteCanvas } from './useCanvasStorage';

/**
 * The Work card's actions for a canvas: copy its public link when published,
 * and delete the whole canvas (only its creator can). Empty for other Works.
 */
export const useCanvasCardMenu = (
  item: WorkSummaryItem,
  storage?: CanvasStorageItem,
): DropdownItem[] => {
  const { t } = useTranslation(['file', 'common']);
  const userId = useUserStore(userProfileSelectors.userId);
  const deleteCanvas = useDeleteCanvas();

  return useMemo(() => {
    if (item.resourceType !== 'canvas' || !item.resourceId) return [];
    const canvasId = item.resourceId;
    const publishedUrl = item.url;
    const items: DropdownItem[] = [];

    if (publishedUrl) {
      items.push({
        icon: <LinkIcon size={16} />,
        key: 'copy-link',
        label: t('canvasStorage.menu.copyLink'),
        onClick: async () => {
          await copyToClipboard(publishedUrl);
          toast.success(t('copySuccess', { ns: 'common' }));
        },
      });
    }

    if (item.userId === userId) {
      if (items.length > 0) items.push({ type: 'divider' });
      items.push({
        danger: true,
        icon: <Trash2Icon size={16} />,
        key: 'delete',
        label: t('canvasStorage.menu.delete'),
        onClick: () =>
          deleteCanvas({
            canvasId,
            publishedUrl,
            title: item.title || t('work.type.canvas'),
            totalSize: storage?.totalSize,
            workId: item.id,
          }),
      });
    }

    return items;
  }, [deleteCanvas, item, storage?.totalSize, t, userId]);
};
