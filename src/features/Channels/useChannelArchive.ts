import type { ChannelListItem } from '@lobechat/types';
import { confirmModal, toast } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import { cacheScope } from '@/libs/replica';
import { channelActions } from '@/store/channel';
import { isTrpcErrorCode } from '@/utils/trpcError';

type SuccessKey =
  'archiveSuccess' | 'archiveThreadSuccess' | 'unarchiveSuccess' | 'unarchiveThreadSuccess';

/** Archiving keeps the user where they are: an archived view stays open and read-only. */
export const useChannelArchive = () => {
  const { t } = useTranslation('channel');

  /** Rejects after reporting, so a confirmation stays open for a retry. */
  const settle = async (write: () => Promise<void>, success: SuccessKey) => {
    try {
      await write();
    } catch (error) {
      console.error('Failed to change the Channel archive state', error);
      toast.error(t(isTrpcErrorCode(error, 'FORBIDDEN') ? 'archiveForbidden' : 'actionFailed'));
      throw error;
    }
    toast.success(t(success));
  };
  const quietly = (promise: Promise<void>) => promise.catch(() => {});

  return {
    /** Replies in progress stop for every member, so the channel asks first. */
    archive: (channel: ChannelListItem) => {
      if (!channel.canDelete) return;
      const scope = cacheScope.get();
      return confirmModal({
        cancelText: t('cancel'),
        content: t('archiveConfirm', { title: channel.title }),
        okText: t('archive'),
        title: t('archive'),
        onOk: () => {
          // A confirmation belongs to the identity that opened it.
          if (cacheScope.get() !== scope) throw new Error('Channel scope changed');
          return settle(() => channelActions.setArchived(channel.id, true), 'archiveSuccess');
        },
      });
    },
    unarchive: (channelId: string) =>
      quietly(settle(() => channelActions.setArchived(channelId, false), 'unarchiveSuccess')),
    setThreadArchived: (channelId: string, threadId: string, archived: boolean) =>
      quietly(
        settle(
          () => channelActions.setThreadArchived(channelId, threadId, archived),
          archived ? 'archiveThreadSuccess' : 'unarchiveThreadSuccess',
        ),
      ),
  };
};
