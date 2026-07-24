'use client';

import { Activity, type CSSProperties, useEffect, useMemo } from 'react';
import { RouterProvider } from 'react-router/dom';

import { createTabRouter } from '@/spa/router/tabRouter';
import { useElectronStore } from '@/store/electron';

import { MAX_LIVE_TAB_ROUTERS, resolveLiveTabIds } from './resolveLiveTabIds';
import { getOrCreateTabRouter, syncTabRouters, type TabRouter } from './tabRouterManager';

interface TabHostProps {
  createRouter?: (url: string) => TabRouter;
}

const rootStyle: CSSProperties = { blockSize: '100%', inlineSize: '100%', position: 'relative' };
const slotStyle: CSSProperties = { inset: 0, position: 'absolute' };
const hiddenSlotStyle: CSSProperties = { ...slotStyle, display: 'none' };

const TabHost = ({ createRouter = createTabRouter }: TabHostProps) => {
  const tabs = useElectronStore((s) => s.tabs);
  const activeTabId = useElectronStore((s) => s.activeTabId);

  const liveIds = useMemo(
    () => resolveLiveTabIds(tabs, activeTabId, MAX_LIVE_TAB_ROUTERS),
    [tabs, activeTabId],
  );

  useEffect(() => {
    syncTabRouters(liveIds);
  }, [liveIds]);

  const liveSet = new Set(liveIds);

  return (
    <div style={rootStyle}>
      {tabs
        .filter((tab) => liveSet.has(tab.id))
        .map((tab) => {
          const isActive = tab.id === activeTabId;

          return (
            <Activity key={tab.id} mode={isActive ? 'visible' : 'hidden'} name={`Tab:${tab.id}`}>
              {/* Activity preserves state but doesn't visually hide the DOM in this React
                version, so force-hide the inactive slot (mirrors home/_layout). */}
              <div style={isActive ? slotStyle : hiddenSlotStyle}>
                <RouterProvider router={getOrCreateTabRouter(tab.id, tab.url, createRouter)} />
              </div>
            </Activity>
          );
        })}
    </div>
  );
};

export default TabHost;
