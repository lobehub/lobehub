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
  Tooltip,
} from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { X } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { electronStylish } from '@/styles/electron';

import { type ResolvedTab } from './hooks/useResolvedTabs';
import { useTabRunning } from './hooks/useTabRunning';
import { useTabUnread } from './hooks/useTabUnread';
import { useStyles } from './styles';
import { buildTabContextMenuItems } from './tabContextMenu';
import { type TabTier } from './tabLayout';

// dnd-kit puts its drag transition in the inline style, which beats any `transition`
// declared in a class — so the tab's own width/background transitions have to be
// composed here or they never run. Width is what makes reactivating a squeezed tab
// (40px → 150px) read as a resize instead of a jump.
const TAB_MOTION = `background-color 0.15s ${cssVar.motionEaseInOut}, width 0.18s ${cssVar.motionEaseInOut}`;

interface TabItemProps {
  index: number;
  isActive: boolean;
  item: ResolvedTab;
  onActivate: (id: string, url: string) => void;
  onClose: (id: string) => void;
  onCloseLeft: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseRight: (id: string) => void;
  onTogglePin: (id: string) => void;
  tier: TabTier;
  totalCount: number;
  width: number;
}

const TabItem = memo<TabItemProps>(
  ({
    item,
    isActive,
    index,
    tier,
    totalCount,
    width,
    onActivate,
    onClose,
    onCloseOthers,
    onCloseLeft,
    onCloseRight,
    onTogglePin,
  }) => {
    const styles = useStyles;
    const { t } = useTranslation('electron');
    const id = item.tab.id;
    const { meta, tab } = item;
    const isRunning = useTabRunning(tab);
    const isUnread = useTabUnread(tab);
    const showUnreadDot = !isRunning && isUnread;
    const pinned = !!tab.pinned;
    const iconOnly = tier === 'icon';
    // Below the narrow tier the icon is the only thing left to identify a tab by. An
    // overlay close button there would both hide it and turn a click meant to switch
    // tabs into a click that closes one.
    const closable = !pinned && !iconOnly && totalCount > 1;

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

    const handleAuxClick = useCallback(
      (e: React.MouseEvent) => {
        if (e.button !== 1 || totalCount === 1) return;
        e.preventDefault();
        onClose(id);
      },
      [onClose, id, totalCount],
    );

    const contextMenuItems = useCallback(
      (): GenericItemType[] =>
        buildTabContextMenuItems({
          id,
          index,
          onClose,
          onCloseLeft,
          onCloseOthers,
          onCloseRight,
          onTogglePin,
          pinned,
          t,
          totalCount,
        }),
      [
        t,
        id,
        index,
        totalCount,
        pinned,
        onClose,
        onCloseOthers,
        onCloseLeft,
        onCloseRight,
        onTogglePin,
      ],
    );

    const indicator = (
      <span className={styles.avatarWrapper}>
        {meta.avatar ? (
          <Avatar
            emojiScaleWithBackground
            avatar={meta.avatar}
            background={meta.backgroundColor}
            shape="square"
            size={16}
          />
        ) : (
          meta.icon && <Icon className={styles.tabIcon} icon={meta.icon} size="small" />
        )}
        {isRunning && <span aria-label={t('tab.running')} className={styles.runningDot} />}
        {showUnreadDot && <span aria-label={t('tab.unread')} className={styles.unreadDot} />}
      </span>
    );

    const face = (
      <Flexbox
        horizontal
        align="center"
        data-active={isActive ? 'true' : undefined}
        data-tier={tier}
        gap={iconOnly ? 0 : 6}
        justify={iconOnly ? 'center' : undefined}
        ref={setNodeRef}
        className={cx(
          electronStylish.nodrag,
          styles.tab,
          isActive && styles.tabActive,
          isDragging && styles.tabDragging,
        )}
        style={{
          transform: CSS.Translate.toString(transform),
          transition: transition ? `${transition}, ${TAB_MOTION}` : TAB_MOTION,
          width,
          zIndex: isDragging ? 1 : undefined,
        }}
        onAuxClick={handleAuxClick}
        onClick={handleClick}
        {...attributes}
        {...listeners}
      >
        {indicator}
        {!iconOnly && (
          <span data-tab-title className={styles.tabTitle}>
            {meta.title}
          </span>
        )}
        {closable && (
          <ActionIcon
            data-tab-close
            className={styles.closeIcon}
            icon={X}
            size="small"
            onClick={handleClose}
          />
        )}
      </Flexbox>
    );

    // The Tooltip wraps unconditionally and opts out via an empty title. Swapping between
    // a wrapped and a bare node would remount the tab on every tier change — which is
    // exactly when the width animates, so the new node would mount at its final width and
    // the transition would never run.
    return (
      <ContextMenuTrigger items={contextMenuItems}>
        <Tooltip title={tier === 'full' ? '' : meta.title}>{face}</Tooltip>
      </ContextMenuTrigger>
    );
  },
);

TabItem.displayName = 'TabItem';

export default TabItem;
