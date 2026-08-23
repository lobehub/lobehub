'use client';

import { useSortable } from '@dnd-kit/sortable';
import { ActionIcon, ContextMenuTrigger, type GenericItemType, Icon, Tooltip } from '@lobehub/ui';
import { cx } from 'antd-style';
import { X } from 'lucide-react';
import { useMotionValue, useSpring, useTransform } from 'motion/react';
import * as m from 'motion/react-m';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/Avatar';
import { electronStylish } from '@/styles/electron';

import { type ResolvedTab } from './hooks/useResolvedTabs';
import { useTabRunning } from './hooks/useTabRunning';
import { useTabUnread } from './hooks/useTabUnread';
import { TAB_SPRING } from './motion';
import { useStyles } from './styles';
import { buildTabContextMenuItems } from './tabContextMenu';
import { resolveTabInset, type TabTier } from './tabLayout';

// 20px box on an 8px-round tab, inset a uniform 3px: 8 - 3 = 5 keeps the button's curve
// concentric with the tab's own. ActionIcon writes blockSize and borderRadius straight
// into its inline style, so a class cannot reach them — but it spreads `style` last.
// `size` stays "small" for the glyph: passing the {blockSize, borderRadius} object form
// sends the same object to Icon's own calcSize, which reads `size` off it, misses, and
// falls back to a 24px glyph inside the 20px box.
const CLOSE_BUTTON_STYLE = { borderRadius: 5, height: 20, width: 20 } as const;

interface TabItemProps {
  /**
   * Where the tab's offset spring starts on the very first render — the strip's previous
   * total width, i.e. the point a newly opened tab is appended at. Seeding it at the
   * target instead would drop the tab straight onto its final offset while its
   * neighbours are still shrinking into place, so the two would overlap by a full tab
   * width and take the whole settle to pull apart.
   */
  enterX: number;
  index: number;
  isActive: boolean;
  isSplitVisible: boolean;
  item: ResolvedTab;
  onActivate: (id: string, url: string) => void;
  onClose: (id: string) => void;
  onCloseLeft: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseRight: (id: string) => void;
  onCloseSplitView: () => void;
  onOpenInSplitView: (id: string) => void;
  onTogglePin: (id: string) => void;
  pinnedCount: number;
  splitViewEnabled: boolean;
  tier: TabTier;
  totalCount: number;
  width: number;
  x: number;
}

const TabItem = memo<TabItemProps>(
  ({
    item,
    isActive,
    isSplitVisible,
    index,
    pinnedCount,
    splitViewEnabled,
    tier,
    totalCount,
    width,
    x,
    enterX,
    onActivate,
    onClose,
    onCloseOthers,
    onCloseLeft,
    onCloseRight,
    onCloseSplitView,
    onOpenInSplitView,
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
    // Which tiers actually show the button is settled in CSS so that it can fade rather
    // than unmount; a lone tab is the one case with no button to fade at all. Staying
    // mounted below the compact tier would otherwise leave an invisible button in the
    // focus order, so those tiers are made inert rather than merely transparent.
    const closable = totalCount > 1;
    const closeInert = tier !== 'full' && tier !== 'compact';

    const { attributes, listeners, setNodeRef, transform, isDragging, isSorting } = useSortable({
      id,
    });

    // A newly opened tab springs out from zero rather than popping in at full width; the
    // motion value starts collapsed and is set to the real width on mount.
    const targetWidth = useMotionValue(0);
    const springWidth = useSpring(targetWidth, TAB_SPRING);
    const targetX = useMotionValue(enterX);
    const springX = useSpring(targetX, TAB_SPRING);
    // The avatar's inset is sprung here rather than switched in the stylesheet. `tier` is
    // resolved from the target width, so a rule keyed on it lands a whole spring before the
    // box reaches the width that rule suits: centring from CSS threw the avatar into the
    // middle of a tab that had not begun to shrink, a jump to the right before the travel
    // left. Seeded at its resolved value rather than at zero, so a tab that mounts straight
    // into the icon tier is centred on its first frame instead of sliding into place.
    const targetInset = useMotionValue(resolveTabInset(width));
    const springInset = useSpring(targetInset, TAB_SPRING);
    const inset = useTransform(springInset, (value) => `${value}px`);
    const wasSorting = useRef(false);

    useEffect(() => {
      targetWidth.set(width);
      targetInset.set(resolveTabInset(width));
    }, [width, targetWidth, targetInset]);

    // Dropping a drag must jump, not animate. dnd-kit clears its transform in the same
    // commit that the reordered store lands, and up to that frame the tab is already
    // sitting at its new offset (springX at the old slot plus dnd-kit's displacement).
    // Animating from there would send it back to where it was picked up and re-slide it.
    useEffect(() => {
      const settledFromDrag = wasSorting.current && !isSorting;
      wasSorting.current = isSorting;

      if (!settledFromDrag) {
        targetX.set(x);
        return;
      }

      targetX.jump(x);
      springX.jump(x);
    }, [x, isSorting, targetX, springX]);

    const handleClick = useCallback(() => {
      if (!isActive || isSplitVisible) {
        onActivate(id, tab.url);
      }
    }, [isActive, isSplitVisible, onActivate, id, tab.url]);

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
          inSplitView: isSplitVisible,
          onClose,
          onCloseLeft,
          onCloseOthers,
          onCloseRight,
          onCloseSplitView,
          onOpenInSplitView,
          onTogglePin,
          pinned,
          pinnedCount,
          splitViewEnabled,
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
        splitViewEnabled,
        isSplitVisible,
        onClose,
        onCloseOthers,
        onCloseLeft,
        onCloseRight,
        onCloseSplitView,
        onOpenInSplitView,
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
            name={meta.title}
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
          pinned && styles.tabPinned,
          isSplitVisible && !isActive && styles.tabSplitVisible,
          isActive && styles.tabActive,
          isDragging && styles.tabDragging,
        )}
        style={{
          paddingInlineStart: inset,
          // dnd-kit's displacement rides the standalone `translate` property while the
          // offset spring owns `transform`. Both are pure x translations, so they
          // compose, and neither has to be folded into the other's value.
          translate: transform ? `${transform.x}px` : undefined,
          width: springWidth,
          x: springX,
          zIndex: isDragging ? 2 : pinned ? 1 : undefined,
        }}
        onAuxClick={handleAuxClick}
        onClick={handleClick}
        {...attributes}
        {...listeners}
      >
        {indicator}
        <span data-tab-title className={styles.tabTitle}>
          {meta.title}
        </span>
        {closable && (
          <ActionIcon
            data-tab-close
            className={styles.closeIcon}
            icon={X}
            inert={closeInert}
            size="small"
            style={CLOSE_BUTTON_STYLE}
            onClick={handleClose}
          />
        )}
      </m.div>
    );

    // The Tooltip wraps unconditionally and opts out through `disabled`. Swapping between
    // a wrapped and a bare node would remount the tab on every tier change — which is
    // exactly when the width and offset animate, so the new node would mount at its final
    // geometry and neither spring would ever run. An empty title is not an opt-out: the
    // component only bails on a nullish one (`title == null`), so a full-width tab used to
    // pop a blank bubble on hover.
    return (
      <ContextMenuTrigger items={contextMenuItems}>
        <Tooltip disabled={tier === 'full'} title={meta.title}>
          {face}
        </Tooltip>
      </ContextMenuTrigger>
    );
  },
);

TabItem.displayName = 'TabItem';

export default TabItem;
