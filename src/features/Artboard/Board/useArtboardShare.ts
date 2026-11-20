import { confirmModal, copyToClipboard, toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openPublishConfirm } from '@/components/PublishConfirmModal';
import { artboardService } from '@/services/artboard';

const serverReason = (error: unknown) => {
  const code = (error as { data?: { code?: string } } | undefined)?.data?.code;
  return code && code !== 'INTERNAL_SERVER_ERROR' ? (error as Error).message : undefined;
};

export interface ArtboardShareState {
  canPublish: boolean;
  hasUpdates: boolean;
  publishedUrl: string | null;
}

export interface ArtboardShareAction {
  danger?: boolean;
  disabled?: boolean;
  key: string;
  label: string;
  onClick: () => void;
}

export type ArtboardShareTrigger =
  | { kind: 'none' }
  | { action: ArtboardShareAction; kind: 'action' }
  | { items: ArtboardShareAction[]; kind: 'menu' };

export const useArtboardShareTrigger = (
  artboardId: string,
  state: ArtboardShareState | undefined,
  refresh: () => unknown,
): ArtboardShareTrigger => {
  const { t } = useTranslation(['project', 'common']);
  const [sharing, setSharing] = useState(false);

  if (!state?.canPublish) return { kind: 'none' };

  const publish = async () => {
    setSharing(true);
    try {
      const { url } = await artboardService.publish(artboardId);
      await refresh();
      await copyToClipboard(url);
      toast.success(t('artboard.share.copied'));
    } catch (error) {
      console.error('[Artboard] share failed', error);
      toast.error(serverReason(error) ?? t('artboard.share.failed'));
    } finally {
      setSharing(false);
    }
  };

  const confirmPublish = (okText: string) =>
    openPublishConfirm({
      note: t('artboard.share.note'),
      okText,
      onOk: () => publish(),
      privacy: t('artboard.share.privacy'),
      title: t('artboard.share.confirmTitle'),
    });

  const { publishedUrl } = state;
  if (!publishedUrl)
    return {
      action: {
        disabled: sharing,
        key: 'share',
        label: sharing ? t('artboard.share.sharing') : t('artboard.share.publish'),
        onClick: () => confirmPublish(t('artboard.share.publish')),
      },
      kind: 'action',
    };

  const unpublish = () =>
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('artboard.share.unpublishConfirm'),
      okButtonProps: { danger: true },
      okText: t('artboard.share.unpublish'),
      onOk: async () => {
        try {
          await artboardService.unpublish(artboardId);
          await refresh();
          toast.success(t('artboard.share.unpublished'));
        } catch (error) {
          console.error('[Artboard] stop sharing failed', error);
          toast.error(serverReason(error) ?? t('artboard.share.unpublishFailed'));
        }
      },
    });

  const items: ArtboardShareAction[] = [];
  if (state.hasUpdates)
    items.push({
      disabled: sharing,
      key: 'update',
      label: sharing ? t('artboard.share.sharing') : t('artboard.share.update'),
      onClick: () => confirmPublish(t('artboard.share.update')),
    });
  items.push(
    {
      key: 'open',
      label: t('artboard.share.open'),
      onClick: () => window.open(publishedUrl, '_blank', 'noopener,noreferrer'),
    },
    {
      key: 'copy',
      label: t('artboard.share.copy'),
      onClick: () =>
        void copyToClipboard(publishedUrl).then(() => toast.success(t('artboard.share.copied'))),
    },
    { danger: true, key: 'unpublish', label: t('artboard.share.unpublish'), onClick: unpublish },
  );
  return { items, kind: 'menu' };
};
