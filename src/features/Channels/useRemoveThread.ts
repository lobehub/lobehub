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

export const useRemoveThread = () => {
  const { t } = useTranslation('channel');
  const location = useActiveLocation();
  const navigate = useWorkspaceAwareNavigate();
  const latest = useLatest({ location, navigate });

  return (channel: ChannelListItem, threadId: string) => {
    if (!channel.canDelete) return;
    const scope = cacheScope.get();
    return confirmModal({
      cancelText: t('cancel'),
      content: t('deleteThreadConfirm'),
      okButtonProps: { danger: true },
      okText: t('deleteThread'),
      title: t('deleteThread'),
      onOk: async () => {
        try {
          if (cacheScope.get() !== scope) throw new Error('Channel scope changed');
          await channelActions.removeThread(channel.id, threadId);
        } catch (error) {
          console.error('Failed to delete Channel thread', error);
          toast.error(
            t(isTrpcErrorCode(error, 'FORBIDDEN') ? 'deleteThreadForbidden' : 'deleteFailed'),
          );
          throw error;
        }
        if (cacheScope.get() !== scope) return;
        const { location, navigate } = latest.current;
        const params = new URLSearchParams(location.search);
        if (matchChannel(location.pathname) === channel.id && params.get('thread') === threadId) {
          params.delete('thread');
          navigate(
            { pathname: location.pathname, search: params.toString(), hash: location.hash },
            { replace: true },
          );
        }
        toast.success(t('deleteThreadSuccess'));
      },
    });
  };
};
