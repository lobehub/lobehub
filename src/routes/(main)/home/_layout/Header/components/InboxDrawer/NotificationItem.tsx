'use client';

import { ActionIcon, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import { ArchiveIcon, BellIcon, ImageIcon, VideoIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const ACTION_CLASS_NAME = 'notification-item-actions';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    cursor: pointer;
    user-select: none;

    .${ACTION_CLASS_NAME} {
      opacity: 0;
      transition: opacity 0.2s ${cssVar.motionEaseOut};
    }

    &:hover {
      .${ACTION_CLASS_NAME} {
        opacity: 1;
      }
    }
  `,
  unreadDot: css`
    flex-shrink: 0;

    width: 8px;
    height: 8px;
    border-radius: 50%;

    background: ${cssVar.colorPrimary};
  `,
}));

const TYPE_ICON_MAP: Record<string, typeof BellIcon> = {
  image_generation_completed: ImageIcon,
  video_generation_completed: VideoIcon,
};

interface NotificationItemProps {
  actionUrl?: string | null;
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
  ({ id, type, title, content, createdAt, isRead, actionUrl, onMarkAsRead, onArchive }) => {
    const navigate = useNavigate();
    const TypeIcon = TYPE_ICON_MAP[type] || BellIcon;

    const handleClick = useCallback(() => {
      if (!isRead) onMarkAsRead(id);
      if (actionUrl) navigate(actionUrl);
    }, [id, isRead, actionUrl, onMarkAsRead, navigate]);

    const handleArchive = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onArchive(id);
      },
      [id, onArchive],
    );

    return (
      <Block
        clickable
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
          <Flexbox flex={1} gap={4} style={{ overflow: 'hidden' }}>
            <Flexbox horizontal align="center" gap={4} justify="space-between">
              <Flexbox horizontal align="center" flex={1} gap={6} style={{ overflow: 'hidden' }}>
                {!isRead && <span className={styles.unreadDot} />}
                <Text ellipsis style={{ fontWeight: isRead ? 400 : 600 }}>
                  {title}
                </Text>
              </Flexbox>
              <Flexbox horizontal align="center" gap={2} style={{ flexShrink: 0 }}>
                <span className={ACTION_CLASS_NAME}>
                  <ActionIcon
                    icon={ArchiveIcon}
                    size={{ blockSize: 24, size: 14 }}
                    onClick={handleArchive}
                  />
                </span>
                <Text fontSize={12} style={{ flexShrink: 0 }} type="secondary">
                  {dayjs(createdAt).fromNow()}
                </Text>
              </Flexbox>
            </Flexbox>
            <Text ellipsis={{ rows: 3 }} fontSize={12} type="secondary">
              {content}
            </Text>
          </Flexbox>
        </Flexbox>
      </Block>
    );
  },
);

export default NotificationItem;
