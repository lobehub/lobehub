'use client';

import { useMemo } from 'react';

import { useElectronStore } from '@/store/electron';

import { usePluginContext } from '../../RecentlyViewed/hooks/usePluginContext';
import { pluginRegistry } from '../../RecentlyViewed/plugins';
import { type ResolvedPageData } from '../../RecentlyViewed/types';

interface UseResolvedTabsResult {
  activeTabId: string | null;
  tabs: ResolvedPageData[];
}

export const useResolvedTabs = (): UseResolvedTabsResult => {
  const ctx = usePluginContext();

  const tabRefs = useElectronStore((s) => s.tabs);
  const activeTabId = useElectronStore((s) => s.activeTabId);

  const tabs = useMemo(() => {
    const results: ResolvedPageData[] = [];
    for (const ref of tabRefs) {
      const resolved = pluginRegistry.resolve(ref, ctx);
      if (resolved) {
        const cachedTitle = ref.cached?.title;
        results.push(cachedTitle ? { ...resolved, title: cachedTitle } : resolved);
      }
    }
    return results;
  }, [tabRefs, ctx]);

  return { activeTabId, tabs };
};
