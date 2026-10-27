import type { ChannelListItem } from '@lobechat/types';
import { confirmModal, toast } from '@lobehub/ui';
import { useLatest } from 'ahooks';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { cacheScope } from '@/libs/replica';
import { channelActions } from '@/store/channel';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { matchChannel } from './paths';

export const useRemoveChannel = () => {
  const { t } = useTranslation('channel');
  const location = useActiveLocation();
  const navigate = useWorkspaceAwareNavigate();
  const latest = useLatest({ location, navigate });

  return (channel: ChannelListItem) => {
    if (!channel.canDelete) return;
    const scope = cacheScope.get();
    return confirmModal({
      cancelText: t('cancel'),
      content: t('moveToTrashConfirm', { title: channel.title }),
      okButtonProps: { danger: true },
      okText: t('moveToTrash'),
      title: t('moveToTrash'),
      onOk: async () => {
        try {
          // A confirmation belongs to the identity that opened it.
          if (cacheScope.get() !== scope) throw new Error('Channel scope changed');
          await channelActions.remove(channel.id);
        } catch (error) {
          console.error('Failed to delete Channel', error);
          toast.error(t(isTrpcErrorCode(error, 'FORBIDDEN') ? 'deleteForbidden' : 'deleteFailed'));
          throw error; // Keep the confirmation open so the user can retry or cancel.
        }
        if (cacheScope.get() !== scope) return;
        if (matchChannel(latest.current.location.pathname) === channel.id)
          latest.current.navigate('/', { replace: true });
        toast.success(t('moveToTrashSuccess'));
      },
    });
  };
};
