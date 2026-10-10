'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Flexbox } from '@lobehub/ui';
import { ActionIcon, type DropdownItem, DropdownMenu } from '@lobehub/ui';
import { cx } from '@lobehub/ui';
import { ChevronDown, Plus } from 'lucide-react';
import { useMotionValue, useSpring } from 'motion/react';
import * as m from 'motion/react-m';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { captureVisibleTabPreviews } from '@/features/Electron/TabHost';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useRegisterDesktopTabHotkeys } from '@/hooks/useHotkeys/desktopTabScope';
import { usePermission } from '@/hooks/usePermission';
import { electronSystemService } from '@/services/electron/system';
import { useElectronStore } from '@/store/electron';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';
import { electronStylish } from '@/styles/electron';

import { useResolvedTabs } from './hooks/useResolvedTabs';
import { useStripWidth } from './hooks/useStripWidth';
import { useTabDrag } from './hooks/useTabDrag';
import { TAB_SPRING } from './motion';
import { resolveTabScope } from './scope';
import { useStyles } from './styles';
import TabItem from './TabItem';
import {
  layoutStrip,
  OVERFLOW_CONTROL_WIDTH,
  resolveTabTier,
  type StripTab,
  TAB_GAP,
} from './tabLayout';

const NEW_TAB_URL = '/';

const TabBar = () => {
  const styles = useStyles;
  const location = useActiveLocation();
  useRegisterDesktopTabHotkeys();
  const { t } = useTranslation('electron');
  const { allowed: canCreate, reason } = usePermission('create_content');
  const [stripWidth, stripRef] = useStripWidth();
  const { tabs, activeTabId } = useResolvedTabs();
  const splitView = useElectronStore((s) => s.splitView);
  const splitViewEnabled = useUserStore(labPreferSelectors.enableDesktopSplitView);
  const switchTab = useElectronStore((s) => s.switchTab);
  const addNewTab = useElectronStore((s) => s.addNewTab);
  const removeTab = useElectronStore((s) => s.removeTab);
  const closeOtherTabs = useElectronStore((s) => s.closeOtherTabs);
  const closeLeftTabs = useElectronStore((s) => s.closeLeftTabs);
  const closeRightTabs = useElectronStore((s) => s.closeRightTabs);
  const moveTab = useElectronStore((s) => s.moveTab);
  const pinTab = useElectronStore((s) => s.pinTab);
  const unpinTab = useElectronStore((s) => s.unpinTab);
  const closeSplitView = useElectronStore((s) => s.closeSplitView);
  const openTabInSplitView = useElectronStore((s) => s.openTabInSplitView);

  const tabIds = useMemo(() => tabs.map((tab) => tab.tab.id), [tabs]);
  const pinnedCount = useMemo(() => tabs.filter((tab) => tab.tab.pinned).length, [tabs]);
  const storeOrder = useMemo<StripTab[]>(
    () => tabs.map((tab) => ({ id: tab.tab.id, pinned: !!tab.tab.pinned })),
    [tabs],
  );

  const innerStripRef = useRef<HTMLDivElement>(null);
  const drag = useTabDrag({
    activeTabId,
    onDrop: moveTab,
    stripRef: innerStripRef,
    stripWidth,
    tabs: storeOrder,
  });

  const stripOrder = useMemo(() => {
    if (!drag.session) return storeOrder;

    const { id, pinned, toIndex } = drag.session;
    const rest = storeOrder.filter((tab) => tab.id !== id);
    if (rest.length === storeOrder.length) return storeOrder;

    return [...rest.slice(0, toIndex), { id, pinned }, ...rest.slice(toIndex)];
  }, [storeOrder, drag.session]);

  const { dividerX, hiddenCount, placements, total, visibleIndices } = useMemo(
    () => layoutStrip({ activeId: activeTabId, stripWidth, tabs: stripOrder }),
    [activeTabId, stripWidth, stripOrder],
  );
  const stripPinnedCount = stripOrder.filter((tab) => tab.pinned).length;

  const tabsById = useMemo(() => new Map(tabs.map((tab) => [tab.tab.id, tab])), [tabs]);

  const targetTotal = useMotionValue(0);
  const springTotal = useSpring(targetTotal, TAB_SPRING);
  const targetDividerX = useMotionValue(dividerX);
  const springDividerX = useSpring(targetDividerX, TAB_SPRING);

  // Read during render, so it still holds the width the strip had on the previous commit
  // — which is exactly where a tab appended this commit should enter from.
  const previousTotal = useRef(0);
  // Tabs restored at boot land in the strip's first populated commit; they should sit at
  // their final geometry rather than spring in from nothing like a tab the user opened.
  const hasPopulated = useRef(false);
  const settleInstantly = !hasPopulated.current;

  useEffect(() => {
    if (settleInstantly) {
      targetTotal.jump(total);
      springTotal.jump(total);
      targetDividerX.jump(dividerX);
      springDividerX.jump(dividerX);
    } else {
      targetTotal.set(total);
      targetDividerX.set(dividerX);
    }
    previousTotal.current = total;
    if (tabs.length > 0 && stripWidth > 0) hasPopulated.current = true;
  }, [
    total,
    dividerX,
    targetTotal,
    springTotal,
    targetDividerX,
    springDividerX,
    tabs.length,
    stripWidth,
    settleInstantly,
  ]);

  const newTabUrl = useMemo(() => {
    const scope = resolveTabScope(location.pathname + location.search);
    const activeSlug = scope.type === 'workspace' ? scope.slug : null;

    return buildWorkspaceAwarePath(NEW_TAB_URL, activeSlug);
  }, [location.pathname, location.search]);

  const handleMoveBy = useCallback(
    (id: string, delta: -1 | 1) => {
      const index = storeOrder.findIndex((tab) => tab.id === id);
      const neighbour = storeOrder[index + delta];
      if (index < 0 || !neighbour || neighbour.pinned !== storeOrder[index].pinned) return;

      moveTab(id, index + delta, neighbour.pinned);
    },
    [storeOrder, moveTab],
  );

  const dragFollow = useMemo(() => {
    const placement = placements.find((item) => item.id === drag.session?.id);
    if (!drag.session || !placement) return undefined;

    return {
      grabFraction: drag.session.grabFraction,
      maxX: total - placement.width,
      pointerX: drag.pointerX,
    };
  }, [drag.session, drag.pointerX, placements, total]);

  const handleActivate = useCallback(
    (id: string) => {
      switchTab(id);
    },
    [switchTab],
  );

  const handleClose = useCallback(
    (id: string) => {
      removeTab(id);
    },
    [removeTab],
  );

  const handleCloseOthers = useCallback(
    (id: string) => {
      closeOtherTabs(id);
    },
    [closeOtherTabs],
  );

  const handleCloseLeft = useCallback(
    (id: string) => {
      closeLeftTabs(id);
    },
    [closeLeftTabs],
  );

  const handleCloseRight = useCallback(
    (id: string) => {
      closeRightTabs(id);
    },
    [closeRightTabs],
  );

  const handleTogglePin = useCallback(
    (id: string) => {
      const target = tabs.find((tab) => tab.tab.id === id);
      if (!target) return;

      if (target.tab.pinned) unpinTab(id);
      else pinTab(id);
    },
    [tabs, pinTab, unpinTab],
  );

  useWatchBroadcast('closeCurrentTabOrWindow', () => {
    if (tabs.length > 1 && activeTabId) {
      handleClose(activeTabId);
    } else {
      void electronSystemService.closeWindow();
    }
  });

  const handleNewTab = useCallback(
    (path?: string) => {
      if (!canCreate) return;

      // Always open a fresh tab, even if one with the same target already exists.
      addNewTab(path ?? newTabUrl);
    },
    [canCreate, addNewTab, newTabUrl],
  );

  useWatchBroadcast('createNewTab', (data) => {
    handleNewTab(data?.path);
  });

  const overflowItems = useCallback((): DropdownItem[] => {
    const visible = new Set(visibleIndices);

    return stripOrder
      .filter((tab) => !tab.pinned)
      .filter((_, index) => !visible.has(index))
      .flatMap(({ id }) => {
        const tab = tabsById.get(id);
        return tab ? [{ key: id, label: tab.meta.title, onClick: () => handleActivate(id) }] : [];
      });
  }, [stripOrder, visibleIndices, tabsById, handleActivate]);

  if (tabs.length === 0) return null;

  // The strip's width is only known after it is in the DOM. Mounting the tabs before that
  // would seed every width spring at the minimum a zero-width strip allows, so the whole
  // row would visibly widen from compact to full once the measurement lands.
  const measured = stripWidth > 0;

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={styles.container}
      gap={TAB_GAP}
      ref={stripRef}
      onPointerEnter={captureVisibleTabPreviews}
    >
      {measured && (
        <>
          {/* One keyed list for pinned and flowing tabs alike. Rendering them as two
          sibling arrays scoped their keys separately, so pinning unmounted the tab
          from one and mounted a fresh one in the other — losing its springs, which
          is why the tab used to pop rather than travel. */}
          <m.div className={styles.strip} ref={innerStripRef} style={{ width: springTotal }}>
            {placements.map((placement) => {
              const tab = tabsById.get(placement.id);
              if (!tab) return null;

              return (
                <TabItem
                  drag={drag.session?.id === placement.id ? dragFollow : undefined}
                  enterWidth={settleInstantly ? placement.width : 0}
                  enterX={settleInstantly ? placement.x : previousTotal.current}
                  index={tabIds.indexOf(placement.id)}
                  isActive={placement.id === activeTabId}
                  item={tab}
                  key={placement.id}
                  pinnedCount={pinnedCount}
                  splitViewEnabled={splitViewEnabled}
                  tier={resolveTabTier(placement.width)}
                  totalCount={tabs.length}
                  width={placement.width}
                  x={placement.x}
                  isSplitVisible={
                    splitView?.primaryTabId === placement.id ||
                    splitView?.secondaryTabId === placement.id
                  }
                  onActivate={handleActivate}
                  onClose={handleClose}
                  onCloseLeft={handleCloseLeft}
                  onCloseOthers={handleCloseOthers}
                  onCloseRight={handleCloseRight}
                  onCloseSplitView={closeSplitView}
                  onDragStart={drag.startDrag}
                  onMoveBy={handleMoveBy}
                  onOpenInSplitView={openTabInSplitView}
                  onTogglePin={handleTogglePin}
                />
              );
            })}
            <m.span
              className={styles.pinnedDivider}
              style={{ opacity: stripPinnedCount > 0 ? 1 : 0, x: springDividerX }}
            />
          </m.div>
          <ActionIcon
            className={cx(electronStylish.nodrag, styles.newTabButton)}
            disabled={!canCreate}
            icon={Plus}
            size="small"
            title={canCreate ? t('tab.newTab') : reason}
            onClick={canCreate ? () => handleNewTab() : undefined}
          />
          {hiddenCount > 0 && (
            <DropdownMenu items={overflowItems} placement={'bottomRight'}>
              <Flexbox
                horizontal
                align={'center'}
                className={cx(electronStylish.nodrag, styles.overflowButton)}
                gap={2}
                style={{ width: OVERFLOW_CONTROL_WIDTH }}
                title={t('tab.overflow', { count: hiddenCount })}
              >
                <ChevronDown size={12} />
                {hiddenCount}
              </Flexbox>
            </DropdownMenu>
          )}
        </>
      )}
    </Flexbox>
  );
};

export default TabBar;
