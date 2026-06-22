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
import { ActionIcon, ScrollArea } from '@lobehub/ui';
import { cx } from 'antd-style';
import { Plus } from 'lucide-react';
import { startTransition, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useRegisterDesktopTabHotkeys } from '@/hooks/useHotkeys/desktopTabScope';
import { usePermission } from '@/hooks/usePermission';
import { electronSystemService } from '@/services/electron/system';
import { useElectronStore } from '@/store/electron';
import { electronStylish } from '@/styles/electron';

import { useResolvedTabs } from './hooks/useResolvedTabs';
import { useStyles } from './styles';
import TabItem from './TabItem';

const TAB_WIDTH = 180;
const TAB_GAP = 0;

// The "+" button always opens a fresh Home tab, regardless of the active page.
const NEW_TAB_URL = '/';

// Tabs only reorder along the horizontal axis, so lock the drag transform to X.
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });

const TabBar = () => {
  const styles = useStyles;
  const navigate = useWorkspaceAwareNavigate();
  useRegisterDesktopTabHotkeys();
  const { t } = useTranslation('electron');
  const { allowed: canCreate, reason } = usePermission('create_content');
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrolledActiveTabIdRef = useRef<string | null>(null);
  const { tabs, activeTabId } = useResolvedTabs();
  const activateTab = useElectronStore((s) => s.activateTab);
  const addTab = useElectronStore((s) => s.addTab);
  const removeTab = useElectronStore((s) => s.removeTab);
  const closeOtherTabs = useElectronStore((s) => s.closeOtherTabs);
  const closeLeftTabs = useElectronStore((s) => s.closeLeftTabs);
  const closeRightTabs = useElectronStore((s) => s.closeRightTabs);
  const reorderTabs = useElectronStore((s) => s.reorderTabs);

  const sensors = useSensors(
    // Require a small drag distance so a plain click still activates the tab.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const tabIds = useMemo(() => tabs.map((tab) => tab.tab.id), [tabs]);

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
    (id: string, url: string) => {
      activateTab(id);
      startTransition(() => navigate(url));
    },
    [activateTab, navigate],
  );

  const navigateToActive = useCallback(() => {
    const { activeTabId: newActiveId, tabs: newTabs } = useElectronStore.getState();
    if (newActiveId) {
      const target = newTabs.find((tab) => tab.id === newActiveId);
      if (target) navigate(target.url);
    } else {
      navigate('/');
    }
  }, [navigate]);

  const handleClose = useCallback(
    (id: string) => {
      const isActive = id === activeTabId;
      const nextActiveId = removeTab(id);

      startTransition(() => {
        if (isActive && nextActiveId) {
          const nextTab = tabs.find((tab) => tab.tab.id === nextActiveId);
          if (nextTab) navigate(nextTab.tab.url);
        }

        if (!nextActiveId) {
          navigate('/');
        }
      });
    },
    [activeTabId, removeTab, tabs, navigate],
  );

  const handleCloseOthers = useCallback(
    (id: string) => {
      closeOtherTabs(id);
      startTransition(() => {
        const target = tabs.find((tab) => tab.tab.id === id);
        if (target) navigate(target.tab.url);
      });
    },
    [closeOtherTabs, tabs, navigate],
  );

  const handleCloseLeft = useCallback(
    (id: string) => {
      closeLeftTabs(id);
      startTransition(() => navigateToActive());
    },
    [closeLeftTabs, navigateToActive],
  );

  const handleCloseRight = useCallback(
    (id: string) => {
      closeRightTabs(id);
      startTransition(() => navigateToActive());
    },
    [closeRightTabs, navigateToActive],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !activeTabId) return;

    const activeIndex = tabs.findIndex((tab) => tab.tab.id === activeTabId);
    if (activeIndex < 0) return;

    // Only scroll into view when the active tab itself changes. Reordering
    // background tabs keeps the same active tab, so skip it — otherwise every
    // drop would yank the viewport back to the active tab and lose the user's
    // scroll position.
    if (scrolledActiveTabIdRef.current === activeTabId) return;
    scrolledActiveTabIdRef.current = activeTabId;

    const tabLeft = activeIndex * (TAB_WIDTH + TAB_GAP);
    const tabRight = tabLeft + TAB_WIDTH;
    const { scrollLeft, clientWidth } = viewport;

    if (tabLeft < scrollLeft) {
      viewport.scrollLeft = tabLeft;
    } else if (tabRight > scrollLeft + clientWidth) {
      viewport.scrollLeft = tabRight - clientWidth;
    }
  }, [activeTabId, tabs]);

  useWatchBroadcast('closeCurrentTabOrWindow', () => {
    if (tabs.length > 1 && activeTabId) {
      handleClose(activeTabId);
    } else {
      void electronSystemService.closeWindow();
    }
  });

  const handleNewTab = useCallback(() => {
    if (!canCreate) return;

    // Always open a fresh Home tab. If a Home tab already exists, addTab just
    // activates it instead of stacking duplicates.
    addTab(NEW_TAB_URL, undefined, true);
    startTransition(() => navigate(NEW_TAB_URL));
  }, [canCreate, addTab, navigate]);

  useWatchBroadcast('createNewTab', () => {
    handleNewTab();
  });

  if (tabs.length === 0) return null;

  return (
    <ScrollArea
      className={styles.container}
      viewportProps={{ ref: viewportRef }}
      contentProps={{
        style: { alignItems: 'center', flexDirection: 'row', gap: TAB_GAP },
      }}
    >
      <DndContext
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        sensors={sensors}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
          {tabs.map((tab, index) => (
            <TabItem
              index={index}
              isActive={tab.tab.id === activeTabId}
              item={tab}
              key={tab.tab.id}
              totalCount={tabs.length}
              onActivate={handleActivate}
              onClose={handleClose}
              onCloseLeft={handleCloseLeft}
              onCloseOthers={handleCloseOthers}
              onCloseRight={handleCloseRight}
            />
          ))}
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
    </ScrollArea>
  );
};

export default TabBar;
