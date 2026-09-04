'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

// Import the manager directly, not the `@/features/Electron/TabHost` barrel,
// whose `TabHost` re-export statically drags `desktopRouter.config` into the
// navigation graph (see activeTabNavigate for the boot-init TDZ this avoids).
import type { HistorySnapshot } from '@/features/Electron/TabHost/tabHistoryTracker';
import {
  getTabHistorySnapshot,
  getTabRouter,
  subscribeTabHistory,
} from '@/features/Electron/TabHost/tabRouterManager';
import { useElectronStore } from '@/store/electron';
import { routerSelectors, useRouterStore } from '@/store/router';

const DEFAULT_SNAPSHOT: HistorySnapshot = { canGoBack: false, canGoForward: false };

export const useNavigationHistory = () => {
  const currentUrl = useRouterStore(routerSelectors.url);
  const activeTabId = useElectronStore((s) => s.activeTabId);
  const addRecentPage = useElectronStore((s) => s.addRecentPage);
  const prevUrlRef = useRef<string | null>(null);

  const subscribe = useCallback(
    (listener: () => void) => (activeTabId ? subscribeTabHistory(activeTabId, listener) : () => {}),
    [activeTabId],
  );
  const getSnapshot = useCallback(
    () => (activeTabId ? getTabHistorySnapshot(activeTabId) : DEFAULT_SNAPSHOT),
    [activeTabId],
  );
  const { canGoBack, canGoForward } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const goBack = useCallback(() => {
    if (activeTabId) void getTabRouter(activeTabId)?.navigate(-1);
  }, [activeTabId]);

  const goForward = useCallback(() => {
    if (activeTabId) void getTabRouter(activeTabId)?.navigate(1);
  }, [activeTabId]);

  useEffect(() => {
    if (prevUrlRef.current === currentUrl) return;
    prevUrlRef.current = currentUrl;
    addRecentPage(currentUrl);
  }, [addRecentPage, currentUrl]);

  useWatchBroadcast('historyGoBack', goBack);
  useWatchBroadcast('historyGoForward', goForward);

  return { canGoBack, canGoForward, goBack, goForward };
};
