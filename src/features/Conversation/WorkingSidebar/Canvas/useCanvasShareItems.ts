import { toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openPublishConfirm } from '@/components/PublishConfirmModal';
import { canvasService, type CanvasVersionDetail } from '@/services/canvas';
import { workService } from '@/services/work';

/**
 * One thing the toolbar's share affordance can do. Deliberately concrete, not
 * `DropdownItem`: with a single action the trigger runs it directly instead of
 * opening a menu, so the caller needs `label`/`onClick` without narrowing a
 * menu-item union.
 */
export interface CanvasShareAction {
  disabled?: boolean;
  key: string;
  label: string;
  onClick: () => void;
}

/**
 * The canvas share actions. They live behind the toolbar's explicit `分享`
 * button rather than the `…` menu: sharing a canvas is the one thing everyone
 * looks for, so it gets its own affordance.
 */
export const useCanvasShareItems = (
  data: CanvasVersionDetail | null | undefined,
  onShared: () => unknown,
): CanvasShareAction[] => {
  const { t } = useTranslation('portal');
  const [sharing, setSharing] = useState(false);

  if (!data) return [];

  const items: CanvasShareAction[] = [];
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

/**
 * What the toolbar's share affordance should render. A single available
 * action is a plain button that runs it — a one-row menu would make the user
 * click twice to reach the only thing on offer (a fresh canvas: the publish
 * confirm modal). Only a real choice turns the trigger into a menu.
 */
export type CanvasShareTrigger =
  | { kind: 'none' }
  | { action: CanvasShareAction; kind: 'action' }
  | { items: CanvasShareAction[]; kind: 'menu' };

export const useCanvasShareTrigger = (
  data: CanvasVersionDetail | null | undefined,
  onShared: () => unknown,
): CanvasShareTrigger => {
  const items = useCanvasShareItems(data, onShared);
  const [only, ...rest] = items;

  if (!only) return { kind: 'none' };
  if (rest.length === 0) return { action: only, kind: 'action' };

  return { items, kind: 'menu' };
};
