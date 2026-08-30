'use client';

import { useEffect, useMemo, useRef } from 'react';

import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import {
  homeSidebarSelectors,
  useHomeSidebarProjection,
} from '@/projection/modules/home/sidebarHooks';
import { desktopTrayService } from '@/services/electron/tray';
import { useElectronStore } from '@/store/electron';

import { useResolvedPages } from '../RecentlyViewed/hooks/useResolvedPages';
import { resolveTrayNavigationSnapshot } from './resolveSnapshot';

export const useTrayMenuSync = () => {
  useFetchAgentList();
  const agents = useHomeSidebarProjection(homeSidebarSelectors.allAgents);
  const scope = useElectronStore((state) => state.activeRecentScope);
  const { pinnedPages, recentPages } = useResolvedPages();
  const lastSnapshotRef = useRef<string | undefined>(undefined);

  const snapshot = useMemo(
    () => resolveTrayNavigationSnapshot({ agents, pinnedPages, recentPages, scope }),
    [agents, pinnedPages, recentPages, scope],
  );

  useEffect(() => {
    const signature = JSON.stringify(snapshot);
    if (signature === lastSnapshotRef.current) return;
    lastSnapshotRef.current = signature;

    void desktopTrayService
      .updateNavigationSnapshot(snapshot)
      .catch((error) => console.error('Failed to synchronize tray menu:', error));
  }, [snapshot]);
};
