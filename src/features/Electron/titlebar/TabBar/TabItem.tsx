'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ActionIcon,
  Avatar,
  ContextMenuTrigger,
  type GenericItemType,
  Icon,
  Tooltip,
} from '@lobehub/ui';
import { cx } from 'antd-style';
import { X } from 'lucide-react';
import { useMotionValue, useSpring } from 'motion/react';
import * as m from 'motion/react-m';
import { memo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { electronStylish } from '@/styles/electron';

import { type ResolvedTab } from './hooks/useResolvedTabs';
import { useTabRunning } from './hooks/useTabRunning';
import { useTabUnread } from './hooks/useTabUnread';
import { useStyles } from './styles';
import { buildTabContextMenuItems } from './tabContextMenu';
import { type TabTier } from './tabLayout';

// Width is driven by a spring rather than a CSS transition: tab widths are a layout
// response — several tabs resize at once whenever one is activated, added or closed —
// and a spring both settles more naturally and is interruptible, so rapid switching
// redirects the motion instead of restarting a fixed 180ms ramp.
//
// Only `width` is animated here. dnd-kit owns `transform`/`transition` on the same
// element (and inline style beats any class-level declaration), so background-color
// keeps its own CSS transition composed alongside dnd-kit's below.
// restDelta of half a pixel: without it the spring keeps ticking rAF long after the
// motion is visually over (measured still 0.1px short at 425ms), which costs a frame
// callback per tab for nothing.
const WIDTH_SPRING = {
  damping: 26,
  mass: 0.4,
  restDelta: 0.5,
  restSpeed: 2,
  stiffness: 380,
} as const;
const BACKGROUND_MOTION = 'background-color 0.15s var(--ant-motion-ease-in-out)';

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
  pinnedCount: number;
  tier: TabTier;
  totalCount: number;
  width: number;
}

const TabItem = memo<TabItemProps>(
  ({
    item,
    isActive,
    index,
    pinnedCount,
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
    // The close button needs 22px of its own, and below the compact tier the tab cannot
    // spare them: the title would be cut to a couple of glyphs to make room for a button
    // that is usually not even shown. Narrower tabs close by middle-click or the context
    // menu instead. At icon width there is the further problem that the icon is the only
    // identity signal left, so overlaying it would also change what a click does.
    const closable = !pinned && totalCount > 1 && (tier === 'full' || tier === 'compact');

    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
      id,
    });

    // A newly opened tab springs out from zero rather than popping in at full width; the
    // motion value starts collapsed and is set to the real width on mount.
    const targetWidth = useMotionValue(0);
    const springWidth = useSpring(targetWidth, WIDTH_SPRING);

    useEffect(() => {
      targetWidth.set(width);
    }, [width, targetWidth]);

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
          pinnedCount,
          t,
          totalCount,
        }),
      [
        t,
        id,
        index,
        totalCount,
        pinned,
        pinnedCount,
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
      <m.div
        data-active={isActive ? 'true' : undefined}
        data-tier={tier}
        ref={setNodeRef}
        className={cx(
          electronStylish.nodrag,
          styles.tab,
          isActive && styles.tabActive,
          isDragging && styles.tabDragging,
        )}
        style={{
          gap: iconOnly ? 0 : 6,
          justifyContent: iconOnly ? 'center' : undefined,
          transform: CSS.Translate.toString(transform),
          transition: transition ? `${transition}, ${BACKGROUND_MOTION}` : BACKGROUND_MOTION,
          width: springWidth,
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
      </m.div>
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
