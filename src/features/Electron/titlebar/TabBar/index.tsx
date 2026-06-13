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
import { usePermission } from '@/hooks/usePermission';
import { electronSystemService } from '@/services/electron/system';
import { desktopRoutes } from '@/spa/router/desktopRouter.config';
import { type NewTabAction } from '@/spa/router/routeMeta';
import { useElectronStore } from '@/store/electron';
import { electronStylish } from '@/styles/electron';

import { useResolvedTabs } from './hooks/useResolvedTabs';
import { matchRouteMeta } from './resolveRouteMeta';
import { useStyles } from './styles';
import TabItem from './TabItem';

const TAB_WIDTH = 180;
const TAB_GAP = 0;

// Tabs only reorder along the horizontal axis, so lock the drag transform to X.
const restrictToHorizontalAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });

// Fallback when the active route doesn't define createNewTab: open the home page,
// so the "+" button stays available on every page.
const DEFAULT_NEW_TAB_ACTION: NewTabAction = {
  onCreate: async () => ({ url: '/' }),
};

const TabBar = () => {
  const styles = useStyles;
  const navigate = useWorkspaceAwareNavigate();
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

  const newTabAction: NewTabAction | null = useMemo(() => {
    if (!canCreate) return null;
    if (!activeTabId) return DEFAULT_NEW_TAB_ACTION;
    const activeTab = tabs.find((tab) => tab.tab.id === activeTabId);
    if (!activeTab) return DEFAULT_NEW_TAB_ACTION;

    const matched = matchRouteMeta(desktopRoutes, activeTab.tab.url);
    return matched.meta?.createNewTab?.(matched.params) ?? DEFAULT_NEW_TAB_ACTION;
  }, [activeTabId, tabs, canCreate]);

  useWatchBroadcast('closeCurrentTabOrWindow', () => {
    if (tabs.length > 1 && activeTabId) {
      handleClose(activeTabId);
    } else {
      void electronSystemService.closeWindow();
    }
  });

  const handleNewTab = useCallback(async () => {
    if (!canCreate) return;
    if (!newTabAction) return;
    let result;
    try {
      result = await newTabAction.onCreate();
    } catch (error) {
      console.error('[TabBar] failed to create new tab:', error);
      return;
    }
    if (!result) return;

    addTab(result.url, result.cached, true);
    startTransition(() => navigate(result.url));
  }, [canCreate, newTabAction, addTab, navigate]);

  useWatchBroadcast('createNewTab', () => {
    void handleNewTab();
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
      {(newTabAction || !canCreate) && (
        <ActionIcon
          className={cx(electronStylish.nodrag, styles.newTabButton)}
          disabled={!canCreate}
          icon={Plus}
          size="small"
          title={canCreate ? t('tab.newTab') : reason}
          onClick={canCreate ? handleNewTab : undefined}
        />
      )}
    </ScrollArea>
  );
};

export default TabBar;
