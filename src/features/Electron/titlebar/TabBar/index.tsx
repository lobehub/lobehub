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
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useRegisterDesktopTabHotkeys } from '@/hooks/useHotkeys/desktopTabScope';
import { usePermission } from '@/hooks/usePermission';
import { electronSystemService } from '@/services/electron/system';
import { useElectronStore } from '@/store/electron';
import { electronStylish } from '@/styles/electron';

import { useResolvedTabs } from './hooks/useResolvedTabs';
import { useStripWidth } from './hooks/useStripWidth';
import { resolveTabScope } from './scope';
import { useStyles } from './styles';
import TabItem from './TabItem';
import {
  allocateTabWidths,
  OVERFLOW_CONTROL_WIDTH,
  PINNED_TAB_WIDTH,
  resolveTabTier,
  TAB_GAP,
} from './tabLayout';

const NEW_TAB_URL = '/';
const NEW_TAB_BUTTON_WIDTH = 26 + TAB_GAP;
const PINNED_DIVIDER_WIDTH = 13;

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
  const activateTab = useElectronStore((s) => s.activateTab);
  const addNewTab = useElectronStore((s) => s.addNewTab);
  const removeTab = useElectronStore((s) => s.removeTab);
  const closeOtherTabs = useElectronStore((s) => s.closeOtherTabs);
  const closeLeftTabs = useElectronStore((s) => s.closeLeftTabs);
  const closeRightTabs = useElectronStore((s) => s.closeRightTabs);
  const reorderTabs = useElectronStore((s) => s.reorderTabs);
  const pinTab = useElectronStore((s) => s.pinTab);
  const unpinTab = useElectronStore((s) => s.unpinTab);

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
      activateTab(id);
    },
    [activateTab],
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

  const renderTab = (tab: (typeof tabs)[number], width: number) => (
    <TabItem
      index={tabIds.indexOf(tab.tab.id)}
      isActive={tab.tab.id === activeTabId}
      item={tab}
      key={tab.tab.id}
      pinnedCount={pinnedTabs.length}
      tier={resolveTabTier(width)}
      totalCount={tabs.length}
      width={width}
      onActivate={handleActivate}
      onClose={handleClose}
      onCloseLeft={handleCloseLeft}
      onCloseOthers={handleCloseOthers}
      onCloseRight={handleCloseRight}
      onTogglePin={handleTogglePin}
    />
  );

  return (
    <Flexbox horizontal align={'center'} className={styles.container} gap={TAB_GAP} ref={stripRef}>
      <DndContext
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        sensors={sensors}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
          {pinnedTabs.map((tab) => renderTab(tab, PINNED_TAB_WIDTH))}
          {pinnedTabs.length > 0 && <span className={styles.pinnedDivider} />}
          {layout.visibleIndices.map((tabIndex, position) =>
            renderTab(flowTabs[tabIndex], layout.widths[position]),
          )}
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
