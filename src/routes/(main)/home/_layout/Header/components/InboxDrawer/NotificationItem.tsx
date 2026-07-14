'use client';

import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { ContextMenuTrigger } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { ArchiveIcon, BellIcon, ImageIcon, MegaphoneIcon, VideoIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { createNotificationDetailModal } from './NotificationDetailModal';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    cursor: pointer;
    user-select: none;
  `,
  unreadDot: css`
    flex-shrink: 0;

    width: 8px;
    height: 8px;
    margin-block-start: 7px;
    border-radius: 50%;

    background: ${cssVar.colorPrimary};
  `,
}));

const TYPE_ICON_MAP: Record<string, typeof BellIcon> = {
  image_generation_completed: ImageIcon,
  system_announcement: MegaphoneIcon,
  video_generation_completed: VideoIcon,
};

interface NotificationItemProps {
  actionUrl?: string | null;
  category?: string;
  content: string;
  createdAt: Date | string;
  id: string;
  isRead: boolean;
  onArchive: (id: string) => void;
  onMarkAsRead: (id: string) => void;
  title: string;
  type: string;
}

const NotificationItem = memo<NotificationItemProps>(
  ({
    id,
    type,
    title,
    content,
    category,
    createdAt,
    isRead,
    actionUrl,
    onMarkAsRead,
    onArchive,
  }) => {
    const { t } = useTranslation('notification');
    const navigate = useWorkspaceAwareNavigate();
    const TypeIcon = TYPE_ICON_MAP[type] || BellIcon;

    const handleClick = useCallback(() => {
      if (!isRead) onMarkAsRead(id);
      const onAction = actionUrl
        ? () => {
            if (/^https?:\/\//i.test(actionUrl)) {
              window.open(actionUrl, '_blank', 'noopener,noreferrer');
            } else {
              navigate(actionUrl);
            }
          }
        : undefined;
      createNotificationDetailModal({
        category,
        content,
        createdAt,
        onAction,
        title,
      });
    }, [id, isRead, actionUrl, onMarkAsRead, navigate, category, content, createdAt, title]);

    const handleArchive = useCallback(() => onArchive(id), [id, onArchive]);

    return (
      <ContextMenuTrigger
        items={[
          {
            icon: ArchiveIcon,
            key: 'archive',
            label: t('inbox.archive'),
            onClick: handleArchive,
          },
        ]}
      >
        <Block
          clickable
          aria-label={title}
          className={styles.container}
          gap={4}
          paddingBlock={8}
          paddingInline={12}
          variant="borderless"
          onClick={handleClick}
        >
          <Flexbox horizontal align="flex-start" gap={8}>
            <Icon
              color={cssVar.colorTextDescription}
              icon={TypeIcon}
              size={18}
              style={{ flexShrink: 0, marginTop: 2 }}
            />
            <Flexbox horizontal align="flex-start" flex={1} gap={6} style={{ overflow: 'hidden' }}>
              {!isRead && <span className={styles.unreadDot} />}
              <Flexbox flex={1} gap={4} style={{ overflow: 'hidden' }}>
                <Text style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{content}</Text>
                <Text fontSize={12} type="secondary">
                  {dayjs(createdAt).fromNow()}
                </Text>
              </Flexbox>
            </Flexbox>
          </Flexbox>
        </Block>
      </ContextMenuTrigger>
    );
  },
);

export default NotificationItem;
