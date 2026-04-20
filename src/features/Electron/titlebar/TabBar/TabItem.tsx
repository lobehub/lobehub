'use client';

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

import { type ResolvedPageData } from '@/features/Electron/titlebar/RecentlyViewed/types';
import { electronStylish } from '@/styles/electron';

import { useTabRunning } from './hooks/useTabRunning';
import { useTabUnread } from './hooks/useTabUnread';
import { useStyles } from './styles';

interface TabItemProps {
  index: number;
  isActive: boolean;
  item: ResolvedPageData;
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
    const id = item.reference.id;
    const isRunning = useTabRunning(item.reference);
    const isUnread = useTabUnread(item.reference);
    const showUnreadDot = !isRunning && isUnread;

    const handleClick = useCallback(() => {
      if (!isActive) {
        onActivate(id, item.url);
      }
    }, [isActive, onActivate, id, item.url]);

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
          key: 'closeCurrentTab',
          label: t('tab.closeCurrentTab'),
          onClick: () => onClose(id),
        },
        {
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
          className={cx(electronStylish.nodrag, styles.tab, isActive && styles.tabActive)}
          gap={6}
          onClick={handleClick}
        >
          {item.avatar ? (
            <span className={styles.avatarWrapper}>
              <Avatar
                emojiScaleWithBackground
                avatar={item.avatar}
                background={item.backgroundColor}
                shape="square"
                size={16}
              />
              {isRunning && <span aria-label={t('tab.running')} className={styles.runningDot} />}
              {showUnreadDot && <span aria-label={t('tab.unread')} className={styles.unreadDot} />}
            </span>
          ) : (
            item.icon && (
              <span className={styles.avatarWrapper}>
                <Icon className={styles.tabIcon} icon={item.icon} size="small" />
                {isRunning && <span aria-label={t('tab.running')} className={styles.runningDot} />}
                {showUnreadDot && (
                  <span aria-label={t('tab.unread')} className={styles.unreadDot} />
                )}
              </span>
            )
          )}
          <span className={styles.tabTitle}>{item.title}</span>
          <ActionIcon className={styles.closeIcon} icon={X} size="small" onClick={handleClose} />
        </Flexbox>
      </ContextMenuTrigger>
    );
  },
);

TabItem.displayName = 'TabItem';

export default TabItem;
