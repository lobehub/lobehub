'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { ActionIcon, ScrollArea } from '@lobehub/ui';
import { cx } from 'antd-style';
import { Plus } from 'lucide-react';
import { startTransition, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

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

// Fallback when the active route doesn't define createNewTab: open the home page,
// so the "+" button stays available on every page.
const DEFAULT_NEW_TAB_ACTION: NewTabAction = {
  onCreate: async () => ({ url: '/' }),
};

const TabBar = () => {
  const styles = useStyles;
  const navigate = useNavigate();
  const { t } = useTranslation('electron');
  const viewportRef = useRef<HTMLDivElement>(null);
  const { tabs, activeTabId } = useResolvedTabs();
  const activateTab = useElectronStore((s) => s.activateTab);
  const addTab = useElectronStore((s) => s.addTab);
  const removeTab = useElectronStore((s) => s.removeTab);
  const closeOtherTabs = useElectronStore((s) => s.closeOtherTabs);
  const closeLeftTabs = useElectronStore((s) => s.closeLeftTabs);
  const closeRightTabs = useElectronStore((s) => s.closeRightTabs);

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

    const tabLeft = activeIndex * (TAB_WIDTH + TAB_GAP);
    const tabRight = tabLeft + TAB_WIDTH;
    const { scrollLeft, clientWidth } = viewport;

    if (tabLeft < scrollLeft) {
      viewport.scrollLeft = tabLeft;
    } else if (tabRight > scrollLeft + clientWidth) {
      viewport.scrollLeft = tabRight - clientWidth;
    }
  }, [activeTabId, tabs]);

  const newTabAction: NewTabAction = useMemo(() => {
    if (!activeTabId) return DEFAULT_NEW_TAB_ACTION;
    const activeTab = tabs.find((tab) => tab.tab.id === activeTabId);
    if (!activeTab) return DEFAULT_NEW_TAB_ACTION;

    const matched = matchRouteMeta(desktopRoutes, activeTab.tab.url);
    return matched.meta?.createNewTab?.(matched.params) ?? DEFAULT_NEW_TAB_ACTION;
  }, [activeTabId, tabs]);

  useWatchBroadcast('closeCurrentTabOrWindow', () => {
    if (tabs.length > 1 && activeTabId) {
      handleClose(activeTabId);
    } else {
      void electronSystemService.closeWindow();
    }
  });

  const handleNewTab = useCallback(async () => {
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
  }, [newTabAction, addTab, navigate]);

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
      <ActionIcon
        className={cx(electronStylish.nodrag, styles.newTabButton)}
        icon={Plus}
        size="small"
        title={t('tab.newTab')}
        onClick={handleNewTab}
      />
    </ScrollArea>
  );
};

export default TabBar;
