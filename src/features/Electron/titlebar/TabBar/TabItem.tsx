'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ActionIcon,
  Avatar,
  ContextMenuTrigger,
  Flexbox,
  type GenericItemType,
  Icon,
} from '@lobehub/ui';
import { cx } from 'antd-style';
import { X } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { electronStylish } from '@/styles/electron';

import { type ResolvedTab } from './hooks/useResolvedTabs';
import { useTabRunning } from './hooks/useTabRunning';
import { useTabUnread } from './hooks/useTabUnread';
import { useStyles } from './styles';

interface TabItemProps {
  index: number;
  isActive: boolean;
  item: ResolvedTab;
  onActivate: (id: string, url: string) => void;
  onClose: (id: string) => void;
  onCloseLeft: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseRight: (id: string) => void;
  totalCount: number;
}

const TabItem = memo<TabItemProps>(
  ({
    item,
    isActive,
    index,
    totalCount,
    onActivate,
    onClose,
    onCloseOthers,
    onCloseLeft,
    onCloseRight,
  }) => {
    const styles = useStyles;
    const { t } = useTranslation('electron');
    const id = item.tab.id;
    const { meta, tab } = item;
    const isRunning = useTabRunning(tab);
    const isUnread = useTabUnread(tab);
    const showUnreadDot = !isRunning && isUnread;

    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
      id,
    });

    const handleClick = useCallback(() => {
      if (!isActive) {
        onActivate(id, tab.url);
      }
    }, [isActive, onActivate, id, tab.url]);

    const handleClose = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onClose(id);
      },
      [onClose, id],
    );

    const contextMenuItems = useCallback(
      (): GenericItemType[] => [
        {
          disabled: totalCount === 1,
          key: 'closeCurrentTab',
          label: t('tab.closeCurrentTab'),
          onClick: () => onClose(id),
        },
        {
          disabled: totalCount === 1,
          key: 'closeOtherTabs',
          label: t('tab.closeOtherTabs'),
          onClick: () => onCloseOthers(id),
        },
        { type: 'divider' },
        {
          disabled: index === 0,
          key: 'closeLeftTabs',
          label: t('tab.closeLeftTabs'),
          onClick: () => onCloseLeft(id),
        },
        {
          disabled: index === totalCount - 1,
          key: 'closeRightTabs',
          label: t('tab.closeRightTabs'),
          onClick: () => onCloseRight(id),
        },
      ],
      [t, id, index, totalCount, onClose, onCloseOthers, onCloseLeft, onCloseRight],
    );

    return (
      <ContextMenuTrigger items={contextMenuItems}>
        <Flexbox
          horizontal
          align="center"
          data-active={isActive ? 'true' : undefined}
          gap={6}
          ref={setNodeRef}
          className={cx(
            electronStylish.nodrag,
            styles.tab,
            isActive && styles.tabActive,
            isDragging && styles.tabDragging,
          )}
          style={{
            transform: CSS.Translate.toString(transform),
            transition,
            zIndex: isDragging ? 1 : undefined,
          }}
          onClick={handleClick}
          {...attributes}
          {...listeners}
        >
          {meta.avatar ? (
            <span className={styles.avatarWrapper}>
              <Avatar
                emojiScaleWithBackground
                avatar={meta.avatar}
                background={meta.backgroundColor}
                shape="square"
                size={16}
              />
              {isRunning && <span aria-label={t('tab.running')} className={styles.runningDot} />}
              {showUnreadDot && <span aria-label={t('tab.unread')} className={styles.unreadDot} />}
            </span>
          ) : (
            meta.icon && (
              <span className={styles.avatarWrapper}>
                <Icon className={styles.tabIcon} icon={meta.icon} size="small" />
                {isRunning && <span aria-label={t('tab.running')} className={styles.runningDot} />}
                {showUnreadDot && (
                  <span aria-label={t('tab.unread')} className={styles.unreadDot} />
                )}
              </span>
            )
          )}
          <span className={styles.tabTitle}>{meta.title}</span>
          {totalCount > 1 && (
            <ActionIcon className={styles.closeIcon} icon={X} size="small" onClick={handleClose} />
          )}
        </Flexbox>
      </ContextMenuTrigger>
    );
  },
);

TabItem.displayName = 'TabItem';

export default TabItem;
