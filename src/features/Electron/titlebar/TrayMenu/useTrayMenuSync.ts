'use client';

import { useEffect, useMemo, useRef } from 'react';

import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { desktopTrayService } from '@/services/electron/tray';
import { useElectronStore } from '@/store/electron';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/slices/agentList/selectors';

import { useResolvedPages } from '../RecentlyViewed/hooks/useResolvedPages';
import { resolveTrayNavigationSnapshot } from './resolveSnapshot';

export const useTrayMenuSync = () => {
  useFetchAgentList();
  const agents = useHomeStore(homeAgentListSelectors.allAgents);
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
