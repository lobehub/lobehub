'use client';

import { memo, useCallback } from 'react';

import DynamicMetaRunner from '@/features/RouteMeta/DynamicMetaRunner';
import { desktopRoutes } from '@/spa/router/desktopRouter.config';
import type { DynamicRouteMeta } from '@/spa/router/routeMeta';
import { useElectronStore } from '@/store/electron';

import { matchRouteMeta } from './resolveRouteMeta';
import type { TabItem } from './types';

interface TabCacheBridgeProps {
  tab: TabItem;
}

const TabCacheBridge = memo<TabCacheBridgeProps>(({ tab }) => {
  const updateTabCache = useElectronStore((s) => s.updateTabCache);
  const matched = matchRouteMeta(desktopRoutes, tab.url);
  const DynamicMeta = matched.meta?.DynamicMeta;

  const handleResolve = useCallback(
    (resolved: DynamicRouteMeta) => {
      updateTabCache(tab.id, resolved);
    },
    [tab.id, updateTabCache],
  );

  if (!DynamicMeta) return null;

  return (
    <DynamicMetaRunner
      key={tab.url}
      DynamicMeta={DynamicMeta}
      params={matched.params}
      onResolve={handleResolve}
    />
  );
});

TabCacheBridge.displayName = 'TabCacheBridge';

const TabCacheBridges = memo(() => {
  const tabs = useElectronStore((s) => s.tabs);

  return (
    <>
      {tabs.map((tab) => (
        <TabCacheBridge key={tab.id} tab={tab} />
      ))}
    </>
  );
});

TabCacheBridges.displayName = 'TabCacheBridges';

export default TabCacheBridges;
