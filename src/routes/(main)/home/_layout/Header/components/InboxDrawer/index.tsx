'use client';

import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { DropdownMenu } from '@lobehub/ui/base-ui';
import { ArchiveIcon, CheckCheckIcon, ListFilterIcon, MoreHorizontalIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import SideBarDrawer from '@/features/NavPanel/SideBarDrawer';
import dynamic from '@/libs/next/dynamic';
import { mutate } from '@/libs/swr';
import { inboxKeys } from '@/libs/swr/keys';
import { notificationService } from '@/services/notification';

const Content = dynamic(() => import('./Content'), {
  loading: () => (
    <Flexbox gap={1} paddingBlock={1} paddingInline={4}>
      <SkeletonList rows={3} />
    </Flexbox>
  ),
  ssr: false,
});

interface InboxDrawerProps {
  onClose: () => void;
  open: boolean;
}

const InboxDrawer = memo<InboxDrawerProps>(({ open, onClose }) => {
  const { t } = useTranslation('notification');
  const [unreadOnly, setUnreadOnly] = useState(false);

  const refreshList = useCallback(() => {
    mutate((key: unknown) => Array.isArray(key) && key[0] === inboxKeys.notifications.root);
    mutate(inboxKeys.unreadCount());
  }, []);

  const handleMarkAsRead = useCallback(
    async (id: string) => {
      await notificationService.markAsRead([id]);
      refreshList();
    },
    [refreshList],
  );

  const handleArchive = useCallback(
    async (id: string) => {
      await notificationService.archive(id);
      refreshList();
    },
    [refreshList],
  );

  const handleMarkAllAsRead = useCallback(async () => {
    await notificationService.markAllAsRead();
    refreshList();
  }, [refreshList]);

  const handleArchiveAll = useCallback(async () => {
    await notificationService.archiveAll();
    refreshList();
  }, [refreshList]);

  const handleToggleFilter = useCallback(() => {
    setUnreadOnly((prev) => !prev);
  }, []);

  return (
    <SideBarDrawer
      open={open}
      action={
        <ActionIcon
          active={unreadOnly}
          icon={ListFilterIcon}
          size={DESKTOP_HEADER_ICON_SMALL_SIZE}
          title={t('inbox.filterUnread')}
          onClick={handleToggleFilter}
        />
      }
      title={
        <Flexbox horizontal align="center" gap={2} style={{ paddingInlineStart: 8 }}>
          <Text ellipsis fontSize={14} style={{ fontWeight: 600 }} weight={400}>
            {t('inbox.title')}
          </Text>
          <DropdownMenu
            placement="bottomLeft"
            items={[
              {
                icon: ArchiveIcon,
                key: 'archive-all',
                label: t('inbox.archiveAll'),
                onClick: handleArchiveAll,
              },
              {
                icon: CheckCheckIcon,
                key: 'mark-all-read',
                label: t('inbox.markAllRead'),
                onClick: handleMarkAllAsRead,
              },
            ]}
          >
            <ActionIcon
              icon={MoreHorizontalIcon}
              size={DESKTOP_HEADER_ICON_SMALL_SIZE}
              title={t('more', { ns: 'common' })}
            />
          </DropdownMenu>
        </Flexbox>
      }
      onClose={onClose}
    >
      <Content
        open={open}
        unreadOnly={unreadOnly}
        onArchive={handleArchive}
        onMarkAsRead={handleMarkAsRead}
      />
    </SideBarDrawer>
  );
});

InboxDrawer.displayName = 'InboxDrawer';

export default InboxDrawer;
