'use client';

import { DEFAULT_USER_AVATAR_URL } from '@lobechat/const';
import type { NotificationMetadata } from '@lobechat/types';
import { Block, Flexbox, Icon } from '@lobehub/ui';
import { Avatar, Button, ContextMenuTrigger, Text, useModalContext } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArchiveIcon, BellIcon, ImageIcon, MegaphoneIcon, VideoIcon } from 'lucide-react';
import type { MouseEvent } from 'react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import type { NativeContextMenuItem } from '@/libs/contextMenu/types';

import { formatNotificationRelativeTime } from './formatNotificationRelativeTime';
import { createNotificationDetailModal } from './NotificationDetailModal';
import { toNotificationPreview } from './toNotificationPreview';
import { useNotificationAgentMeta } from './useNotificationAgentMeta';

const styles = createStaticStyles(({ css }) => ({
  unreadDot: css`
    flex-shrink: 0;

    width: 8px;
    height: 8px;
    margin-block-start: 7px;
    border-radius: 50%;

    background: ${cssVar.colorInfo};
  `,
}));

const TYPE_ICON_MAP: Record<string, typeof BellIcon> = {
  image_generation_completed: ImageIcon,
  system_announcement: MegaphoneIcon,
  video_generation_completed: VideoIcon,
};

interface NotificationItemProps {
  actionUrl?: string | null;
  content: string;
  context?: string | null;
  createdAt: Date | string;
  id: string;
  isRead: boolean;
  metadata?: NotificationMetadata | null;
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
    context,
    createdAt,
    isRead,
    actionUrl,
    metadata,
    onMarkAsRead,
    onArchive,
  }) => {
    const { i18n, t } = useTranslation('notification');
    const { close } = useModalContext();
    const navigate = useWorkspaceAwareNavigate();
    const TypeIcon = TYPE_ICON_MAP[type] || BellIcon;
    const dateLocale = i18n.resolvedLanguage || i18n.language;
    const preview = useMemo(() => toNotificationPreview(content), [content]);
    const actor = metadata?.actor;
    const agent = useNotificationAgentMeta(actionUrl, metadata);

    const handleMarkAsRead = useCallback(() => {
      if (!isRead) onMarkAsRead(id);
    }, [id, isRead, onMarkAsRead]);

    const handleAction = useCallback(() => {
      handleMarkAsRead();

      if (!actionUrl) return;

      if (/^https?:\/\//i.test(actionUrl)) {
        window.open(actionUrl, '_blank', 'noopener,noreferrer');
      } else {
        navigate(actionUrl);
        close();
      }
    }, [actionUrl, close, handleMarkAsRead, navigate]);

    // The row only shows a two-line preview, so a click must always give access
    // to the full body — the detail modal is the only place a content-only
    // notification (no actionUrl) can be read in full.
    const handleOpenDetail = useCallback(() => {
      handleMarkAsRead();
      createNotificationDetailModal({
        content,
        context,
        createdAt,
        onAction: actionUrl && !metadata?.transfer ? handleAction : undefined,
        title,
      });
    }, [actionUrl, content, context, createdAt, handleAction, handleMarkAsRead, metadata, title]);

    const handleActionClick = useCallback(
      (event: MouseEvent) => {
        event.stopPropagation();
        handleAction();
      },
      [handleAction],
    );

    const handleArchive = useCallback(() => onArchive(id), [id, onArchive]);

    const contextMenuItems: NativeContextMenuItem[] = [
      {
        icon: ArchiveIcon,
        key: 'archive',
        label: t('inbox.archive'),
        onClick: handleArchive,
        sfSymbol: 'archivebox',
      },
    ];

    return (
      <ContextMenuTrigger items={contextMenuItems}>
        <Block
          aria-label={title}
          gap={4}
          paddingBlock={12}
          paddingInline={20}
          style={{ cursor: 'pointer' }}
          variant="borderless"
          onClick={handleOpenDetail}
        >
          <Flexbox horizontal align="flex-start" gap={12}>
            {!isRead && <span className={styles.unreadDot} />}
            {actor ? (
              <Avatar
                alt={actor.name}
                avatar={actor.avatar || DEFAULT_USER_AVATAR_URL}
                shape="circle"
                size={32}
                style={{ flex: 'none' }}
              />
            ) : agent ? (
              <Avatar
                emojiScaleWithBackground
                alt={agent.title}
                avatar={agent.avatar}
                background={agent.backgroundColor}
                shape="circle"
                size={32}
                style={{ flex: 'none' }}
              />
            ) : (
              <ProductLogo size={32} style={{ flex: 'none' }} />
            )}
            <Flexbox flex={1} gap={6} style={{ minWidth: 0, overflow: 'hidden' }}>
              <Text ellipsis={{ rows: 2 }} wordBreak="break-word">
                {preview}
              </Text>
              <Flexbox horizontal align="center" gap={6}>
                {/* The actor snapshot exists so the reader can tell WHO acted
                    without recognizing the avatar — render the name visibly. */}
                {actor?.name && (
                  <Text
                    ellipsis
                    fontSize={12}
                    style={{ flexShrink: 0, maxWidth: 160 }}
                    type="secondary"
                  >
                    {actor.name}
                  </Text>
                )}
                <Text fontSize={12} style={{ flexShrink: 0 }} type="secondary">
                  {formatNotificationRelativeTime(createdAt, dateLocale)}
                </Text>
                {context && (
                  <>
                    <Icon color={cssVar.colorTextDescription} icon={TypeIcon} size={12} />
                    <Text ellipsis fontSize={12} type="secondary">
                      {context}
                    </Text>
                  </>
                )}
              </Flexbox>
            </Flexbox>
            {/* Always reserve the action column so text width stays aligned across rows */}
            <Flexbox
              horizontal
              align="center"
              flex="none"
              justify="flex-end"
              style={{ alignSelf: 'stretch', width: 144 }}
            >
              {/* Transfer-linked rows keep an actionUrl purely as the email
                  CTA's landing target (workspace home). In-app that target is
                  where the user already is, so no dead "view detail" button. */}
              {actionUrl && !metadata?.transfer && (
                <Button onClick={handleActionClick}>{t('inbox.viewDetail')}</Button>
              )}
            </Flexbox>
          </Flexbox>
        </Block>
      </ContextMenuTrigger>
    );
  },
);

NotificationItem.displayName = 'NotificationItem';

export default NotificationItem;
