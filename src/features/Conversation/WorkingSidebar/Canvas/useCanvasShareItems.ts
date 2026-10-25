import { type DropdownItem, toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openPublishConfirm } from '@/components/PublishConfirmModal';
import { canvasService, type CanvasVersionDetail } from '@/services/canvas';
import { workService } from '@/services/work';

/**
 * The canvas share actions. They live behind the toolbar's explicit `分享`
 * button rather than the `…` menu: sharing a canvas is the one thing everyone
 * looks for, so it gets its own affordance.
 */
export const useCanvasShareItems = (
  data: CanvasVersionDetail | null | undefined,
  onShared: () => unknown,
): DropdownItem[] => {
  const { t } = useTranslation('portal');
  const [sharing, setSharing] = useState(false);

  if (!data) return [];

  const items: DropdownItem[] = [];
  const publishedUrl = data.publishedUrl;

  if (data.canPublish && (sharing || data.publishedVersion !== data.latestVersion)) {
    const share = async () => {
      setSharing(true);
      try {
        const result = await canvasService.publish(data.canvasId);
        await onShared();
        await workService.refreshAllConversations();
        toast.success(t('canvas.share.success', { version: result.publishedVersion }));
      } catch (error) {
        console.error('[Canvas] share failed', error);
        toast.error(t('canvas.share.failed'));
      } finally {
        setSharing(false);
      }
    };

    const shareLabel = t(publishedUrl ? 'canvas.share.update' : 'canvas.share.publish', {
      version: data.latestVersion,
    });

    items.push({
      disabled: sharing,
      key: 'share',
      label: sharing ? t('canvas.share.sharing') : shareLabel,
      onClick: () =>
        openPublishConfirm({
          note: t('canvas.share.note'),
          okText: shareLabel,
          onOk: () => void share(),
          privacy: t('canvas.share.privacy'),
          title: t('canvas.share.confirmTitle'),
        }),
    });
  }

  if (publishedUrl) {
    items.push({
      key: 'open-public',
      label: t('canvas.share.open'),
      onClick: () => window.open(publishedUrl, '_blank', 'noopener,noreferrer'),
    });
  }

  return items;
};
