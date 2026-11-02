import type { ChannelListItem, ChannelPublicThread } from '@lobechat/types';
import { Archive, ArchiveRestore, Trash } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useChannelArchive } from './useChannelArchive';
import { useRemoveThread } from './useRemoveThread';

/** Thread actions shared by the sidebar entry and the open thread's header. */
export const useThreadMenu = () => {
  const { t } = useTranslation('channel');
  const removeThread = useRemoveThread();
  const { setThreadArchived } = useChannelArchive();

  // An archived channel is read-only as a whole, its threads included.
  return (channel: ChannelListItem, thread: ChannelPublicThread) =>
    channel.canDelete && channel.status !== 'archived'
      ? [
          thread.status === 'archived'
            ? {
                icon: ArchiveRestore,
                key: 'unarchiveThread',
                label: t('unarchiveThread'),
                onClick: () => void setThreadArchived(channel.id, thread.id, false),
              }
            : {
                icon: Archive,
                key: 'archiveThread',
                label: t('archiveThread'),
                onClick: () => void setThreadArchived(channel.id, thread.id, true),
              },
          { type: 'divider' as const },
          {
            danger: true,
            icon: Trash,
            key: 'deleteThread',
            label: t('deleteThread'),
            onClick: () => removeThread(channel, thread.id),
          },
        ]
      : [];
};
