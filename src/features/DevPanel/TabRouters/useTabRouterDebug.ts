'use client';

import { useEffect, useState } from 'react';

// Imported from the concrete modules, not the `TabHost` barrel: that barrel
// re-exports `TabHost.tsx`, which would drag the whole desktop route tree into
// this dev-only chunk.
import {
  MAX_LIVE_TAB_ROUTERS,
  resolveLiveTabIds,
} from '@/features/Electron/TabHost/resolveLiveTabIds';
import {
  getTabHistorySnapshot,
  getTabRouter,
  getTabRouterIds,
} from '@/features/Electron/TabHost/tabRouterManager';
import { tabScopeKey } from '@/features/Electron/titlebar/TabBar/scope';
import { useElectronStore } from '@/store/electron';

export interface TabRouterRow {
  active: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  drift: boolean;
  id: string;
  lastVisited: number;
  live: boolean;
  rank: number;
  routerUrl: string | null;
  shouldBeLive: boolean;
  storeUrl: string;
  title?: string;
}

export interface TabRouterDebug {
  cap: number;
  liveCount: number;
  orphanIds: string[];
  rows: TabRouterRow[];
  scopeKey: string;
}

// Router-side facts (memory-router location, history depth, which instances the
// manager still holds) live outside React, and a hidden tab can navigate without
// any store write — poll instead of trying to subscribe to each of them.
const useTick = (interval: number): void => {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), interval);
    return () => clearInterval(timer);
  }, [interval]);
};

export const useTabRouterDebug = (): TabRouterDebug => {
  const tabs = useElectronStore((s) => s.tabs);
  const activeTabId = useElectronStore((s) => s.activeTabId);
  const activeTabScope = useElectronStore((s) => s.activeTabScope);

  useTick(1000);

  const shouldBeLive = new Set(resolveLiveTabIds(tabs, activeTabId, MAX_LIVE_TAB_ROUTERS));
  const routerIds = getTabRouterIds();
  const liveIds = new Set(routerIds);

  const evictionOrder = tabs
    .map((tab, index) => ({ id: tab.id, index, lastVisited: tab.lastVisited }))
    .sort((a, b) => b.lastVisited - a.lastVisited || a.index - b.index)
    .map((entry) => entry.id);

  const rows = tabs.map((tab) => {
    const location = liveIds.has(tab.id) ? getTabRouter(tab.id)?.state.location : undefined;
    const routerUrl = location ? `${location.pathname}${location.search}${location.hash}` : null;
    const history = getTabHistorySnapshot(tab.id);

    return {
      active: tab.id === activeTabId,
      canGoBack: history.canGoBack,
      canGoForward: history.canGoForward,
      drift: routerUrl !== null && routerUrl !== tab.url,
      id: tab.id,
      lastVisited: tab.lastVisited,
      live: liveIds.has(tab.id),
      rank: evictionOrder.indexOf(tab.id) + 1,
      routerUrl,
      shouldBeLive: shouldBeLive.has(tab.id),
      storeUrl: tab.url,
      title: tab.cached?.title,
    };
  });

  return {
    cap: MAX_LIVE_TAB_ROUTERS,
    liveCount: routerIds.length,
    orphanIds: routerIds.filter((id) => !tabs.some((tab) => tab.id === id)),
    rows,
    scopeKey: tabScopeKey(activeTabScope),
  };
};
