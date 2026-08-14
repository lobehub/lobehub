'use client';

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { ActionIcon, Flexbox } from '@lobehub/ui';
import { type DropdownItem, DropdownMenu } from '@lobehub/ui/base-ui';
import { cx } from 'antd-style';
import { ChevronDown, Plus } from 'lucide-react';
import { useMotionValue, useSpring } from 'motion/react';
import * as m from 'motion/react-m';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

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
import { TAB_SPRING } from './motion';
import { resolveTabScope } from './scope';
import { useStyles } from './styles';
import TabItem from './TabItem';
import {
  allocateTabWidths,
  OVERFLOW_CONTROL_WIDTH,
  PINNED_DIVIDER_WIDTH,
  PINNED_TAB_WIDTH,
  resolvePlacements,
  resolveTabTier,
  TAB_GAP,
} from './tabLayout';

const NEW_TAB_URL = '/';
const NEW_TAB_BUTTON_WIDTH = 26 + TAB_GAP;

// Tabs only reorder along the horizontal axis, so lock the drag transform to X.
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });

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
  const reorderTabs = useElectronStore((s) => s.reorderTabs);
  const pinTab = useElectronStore((s) => s.pinTab);
  const unpinTab = useElectronStore((s) => s.unpinTab);
  const closeSplitView = useElectronStore((s) => s.closeSplitView);
  const openTabInSplitView = useElectronStore((s) => s.openTabInSplitView);

  const sensors = useSensors(
    // Require a small drag distance so a plain click still activates the tab.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const tabIds = useMemo(() => tabs.map((tab) => tab.tab.id), [tabs]);
  const pinnedTabs = useMemo(() => tabs.filter((tab) => tab.tab.pinned), [tabs]);
  const flowTabs = useMemo(() => tabs.filter((tab) => !tab.tab.pinned), [tabs]);

  const layout = useMemo(() => {
    const pinnedWidth = pinnedTabs.length
      ? pinnedTabs.length * (PINNED_TAB_WIDTH + TAB_GAP) + PINNED_DIVIDER_WIDTH
      : 0;

    return allocateTabWidths({
      activeIndex: flowTabs.findIndex((tab) => tab.tab.id === activeTabId),
      count: flowTabs.length,
      usableWidth: Math.max(0, stripWidth - pinnedWidth - NEW_TAB_BUTTON_WIDTH),
    });
  }, [flowTabs, pinnedTabs.length, activeTabId, stripWidth]);

  const { dividerX, placements, total } = useMemo(
    () =>
      resolvePlacements({
        flowIds: flowTabs.map((tab) => tab.tab.id),
        pinnedIds: pinnedTabs.map((tab) => tab.tab.id),
        visibleIndices: layout.visibleIndices,
        widths: layout.widths,
      }),
    [flowTabs, pinnedTabs, layout],
  );

  const tabsById = useMemo(() => new Map(tabs.map((tab) => [tab.tab.id, tab])), [tabs]);

  const targetTotal = useMotionValue(0);
  const springTotal = useSpring(targetTotal, TAB_SPRING);
  const targetDividerX = useMotionValue(dividerX);
  const springDividerX = useSpring(targetDividerX, TAB_SPRING);

  // Read during render, so it still holds the width the strip had on the previous commit
  // — which is exactly where a tab appended this commit should enter from.
  const previousTotal = useRef(0);

  useEffect(() => {
    targetTotal.set(total);
    targetDividerX.set(dividerX);
    previousTotal.current = total;
  }, [total, dividerX, targetTotal, targetDividerX]);

  const newTabUrl = useMemo(() => {
    const scope = resolveTabScope(location.pathname + location.search);
    const activeSlug = scope.type === 'workspace' ? scope.slug : null;

    return buildWorkspaceAwarePath(NEW_TAB_URL, activeSlug);
  }, [location.pathname, location.search]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const fromIndex = tabIds.indexOf(active.id as string);
      const toIndex = tabIds.indexOf(over.id as string);
      if (fromIndex < 0 || toIndex < 0) return;

      reorderTabs(fromIndex, toIndex);
    },
    [tabIds, reorderTabs],
  );

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

  const handleNewTab = useCallback(() => {
    if (!canCreate) return;

    // Always open a fresh Home tab, even if a Home tab already exists.
    addNewTab(newTabUrl);
  }, [canCreate, addNewTab, newTabUrl]);

  useWatchBroadcast('createNewTab', () => {
    handleNewTab();
  });

  const overflowItems = useCallback((): DropdownItem[] => {
    const visible = new Set(layout.visibleIndices);

    return flowTabs
      .map((tab, index) => ({ index, tab }))
      .filter(({ index }) => !visible.has(index))
      .map(({ tab }) => ({
        key: tab.tab.id,
        label: tab.meta.title,
        onClick: () => handleActivate(tab.tab.id),
      }));
  }, [flowTabs, layout.visibleIndices, handleActivate]);

  if (tabs.length === 0) return null;

  return (
    <Flexbox horizontal align={'center'} className={styles.container} gap={TAB_GAP} ref={stripRef}>
      <DndContext
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        sensors={sensors}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
          {/* One keyed list for pinned and flowing tabs alike. Rendering them as two
              sibling arrays scoped their keys separately, so pinning unmounted the tab
              from one and mounted a fresh one in the other — losing its springs, which
              is why the tab used to pop rather than travel. */}
          <m.div className={styles.strip} style={{ width: springTotal }}>
            {placements.map((placement) => {
              const tab = tabsById.get(placement.id);
              if (!tab) return null;

              return (
                <TabItem
                  enterX={previousTotal.current}
                  index={tabIds.indexOf(placement.id)}
                  isActive={placement.id === activeTabId}
                  item={tab}
                  key={placement.id}
                  pinnedCount={pinnedTabs.length}
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
                  onOpenInSplitView={openTabInSplitView}
                  onTogglePin={handleTogglePin}
                />
              );
            })}
            <m.span
              className={styles.pinnedDivider}
              style={{ opacity: pinnedTabs.length > 0 ? 1 : 0, x: springDividerX }}
            />
          </m.div>
        </SortableContext>
      </DndContext>
      <ActionIcon
        className={cx(electronStylish.nodrag, styles.newTabButton)}
        disabled={!canCreate}
        icon={Plus}
        size="small"
        title={canCreate ? t('tab.newTab') : reason}
        onClick={canCreate ? handleNewTab : undefined}
      />
      {layout.hiddenCount > 0 && (
        <DropdownMenu items={overflowItems} placement={'bottomRight'}>
          <Flexbox
            horizontal
            align={'center'}
            className={cx(electronStylish.nodrag, styles.overflowButton)}
            gap={2}
            style={{ width: OVERFLOW_CONTROL_WIDTH }}
            title={t('tab.overflow', { count: layout.hiddenCount })}
          >
            <ChevronDown size={12} />
            {layout.hiddenCount}
          </Flexbox>
        </DropdownMenu>
      )}
    </Flexbox>
  );
};

export default TabBar;
