'use client';

import { ScrollArea } from '@lobehub/ui';
import { startTransition, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { pluginRegistry } from '@/features/Electron/titlebar/RecentlyViewed/plugins';
import { useElectronStore } from '@/store/electron';

import { useResolvedTabs } from './hooks/useResolvedTabs';
import { useStyles } from './styles';
import TabItem from './TabItem';

const TAB_WIDTH = 180;
const TAB_GAP = 2;

const TabBar = () => {
  const styles = useStyles;
  const navigate = useNavigate();
  const viewportRef = useRef<HTMLDivElement>(null);
  const { tabs, activeTabId } = useResolvedTabs();
  const activateTab = useElectronStore((s) => s.activateTab);
  const removeTab = useElectronStore((s) => s.removeTab);
  const closeOtherTabs = useElectronStore((s) => s.closeOtherTabs);
  const closeLeftTabs = useElectronStore((s) => s.closeLeftTabs);
  const closeRightTabs = useElectronStore((s) => s.closeRightTabs);

  const handleActivate = useCallback(
    (id: string, url: string) => {
      // Prioritize updating the Tab activation state (high priority)
      activateTab(id);
      const tab = tabs.find((t) => t.reference.id === id);
      if (tab) pluginRegistry.onActivate(tab.reference);
      // Degrade route navigation to startTransition (low priority)
      startTransition(() => navigate(url));
    },
    [activateTab, navigate, tabs],
  );

  const navigateToActive = useCallback(() => {
    const { activeTabId: newActiveId, tabs: newTabs } = useElectronStore.getState();
    if (newActiveId) {
      const target = newTabs.find((t) => t.id === newActiveId);
      if (target) {
        const resolved = tabs.find((t) => t.reference.id === newActiveId);
        if (resolved) navigate(resolved.url);
      }
    } else {
      navigate('/');
    }
  }, [tabs, navigate]);

  const handleClose = useCallback(
    (id: string) => {
      const isActive = id === activeTabId;
      const nextActiveId = removeTab(id);

      startTransition(() => {
        if (isActive && nextActiveId) {
          const nextTab = tabs.find((t) => t.reference.id === nextActiveId);
          if (nextTab) {
            navigate(nextTab.url);
          }
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
        const target = tabs.find((t) => t.reference.id === id);
        if (target) navigate(target.url);
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

    const activeIndex = tabs.findIndex((t) => t.reference.id === activeTabId);
    if (activeIndex < 0) return;

    const tabLeft = activeIndex * (TAB_WIDTH + TAB_GAP);
    const tabRight = tabLeft + TAB_WIDTH;
    const { scrollLeft, clientWidth } = viewport;

    if (tabLeft < scrollLeft) {
      viewport.scrollLeft = tabLeft;
    } else if (tabRight > scrollLeft + clientWidth) {
      viewport.scrollLeft = tabRight - clientWidth;
    }
  }, [activeTabId, tabs]);

  if (tabs.length < 2) return null;

  return (
    <ScrollArea
      className={styles.container}
      viewportProps={{ ref: viewportRef }}
      contentProps={{
        style: { alignItems: 'center', flexDirection: 'row', gap: TAB_GAP },
      }}
    >
      {tabs.map((tab, index) => (
        <TabItem
          index={index}
          isActive={tab.reference.id === activeTabId}
          item={tab}
          key={tab.reference.id}
          totalCount={tabs.length}
          onActivate={handleActivate}
          onClose={handleClose}
          onCloseLeft={handleCloseLeft}
          onCloseOthers={handleCloseOthers}
          onCloseRight={handleCloseRight}
        />
      ))}
    </ScrollArea>
  );
};

export default TabBar;
