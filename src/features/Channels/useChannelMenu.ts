import type { ChannelListItem } from '@lobechat/types';
import { CHANNEL_LIMITS } from '@lobechat/types';
import { copyToClipboard, toast } from '@lobehub/ui';
import { Archive, ArchiveRestore, Copy, LogOut, PencilLine, Trash } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { openRenameModal } from '@/components/RenameModal';
import { channelActions } from '@/store/channel';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { canLeaveChannel } from './memberManagement';
import { useChannelArchive } from './useChannelArchive';
import { useLeaveChannel } from './useMemberActions';
import { useRemoveChannel } from './useRemoveChannel';

/**
 * A Channel's menu wherever it is listed: rename, copy id, archive, leave, and move to the trash.
 */
export const useChannelMenu = () => {
  const { t } = useTranslation('channel');
  const remove = useRemoveChannel();
  const { archive, unarchive } = useChannelArchive();
  const leave = useLeaveChannel();

  const rename = (channel: ChannelListItem) =>
    openRenameModal({
      defaultValue: channel.title,
      maxLength: CHANNEL_LIMITS.titleLength,
      title: t('rename'),
      onSave: async (title) => {
        try {
          await channelActions.rename(channel.id, title);
        } catch (error) {
          console.error('Failed to rename Channel', error);
          toast.error(t(isTrpcErrorCode(error, 'FORBIDDEN') ? 'renameForbidden' : 'renameFailed'));
          throw error; // Keep the dialog open with the typed name.
        }
      },
    });

  return (channel: ChannelListItem) => [
    ...(channel.canDelete && channel.status !== 'archived'
      ? [{ icon: PencilLine, key: 'rename', label: t('rename'), onClick: () => rename(channel) }]
      : []),
    {
      icon: Copy,
      key: 'copyId',
      label: t('copyId'),
      onClick: async () => {
        try {
          await copyToClipboard(channel.id);
          toast.success(t('copyIdSuccess'));
        } catch (error) {
          console.error('Failed to copy Channel id', error);
          toast.error(t('actionFailed'));
        }
      },
    },
    ...(canLeaveChannel(channel)
      ? [
          { type: 'divider' as const },
          { icon: LogOut, key: 'leave', label: t('leave'), onClick: () => leave(channel) },
        ]
      : []),
    ...(channel.canDelete
      ? [
          channel.status === 'archived'
            ? {
                icon: ArchiveRestore,
                key: 'unarchive',
                label: t('unarchive'),
                onClick: () => void unarchive(channel.id),
              }
            : {
                icon: Archive,
                key: 'archive',
                label: t('archive'),
                onClick: () => archive(channel),
              },
          { type: 'divider' as const },
          {
            danger: true,
            icon: Trash,
            key: 'delete',
            label: t('moveToTrash'),
            onClick: () => remove(channel),
          },
        ]
      : []),
  ];
};
