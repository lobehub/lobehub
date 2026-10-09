'use client';

import isEqual from 'fast-deep-equal';
import { useEffect, useMemo, useRef } from 'react';

import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useClientDataSWR } from '@/libs/swr';
import { recentKeys } from '@/libs/swr/keys';
import { useCacheScope } from '@/libs/swr/useCacheScope';
import { desktopTrayService } from '@/services/electron/tray';
import { recentService } from '@/services/recent';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/slices/agentList/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import { useResolvedPages } from '../RecentlyViewed/hooks/useResolvedPages';
import { resolveTrayNavigationSnapshot } from './resolveSnapshot';
import { selectActiveTopics } from './selectActiveTopics';

const TRAY_RECENT_FETCH_LIMIT = 10;

export const useTrayMenuSync = () => {
  useFetchAgentList();
  const agents = useHomeStore(homeAgentListSelectors.allAgents);
  const scope = useElectronStore((state) => state.activeRecentScope);
  const { pinnedPages, recentPages } = useResolvedPages();
  const activeTopics = useChatStore(selectActiveTopics, isEqual);
  const isLogin = useUserStore(authSelectors.isLogin);
  const cacheScope = useCacheScope();
  const { data: recents, mutate: refreshRecents } = useClientDataSWR(
    isLogin ? recentKeys.trayList(TRAY_RECENT_FETCH_LIMIT, cacheScope) : null,
    () => recentService.getAll(TRAY_RECENT_FETCH_LIMIT, undefined, false, true),
  );
  const activeSignature = activeTopics.map(({ status, topicId }) => topicId + status).join();
  const lastSnapshotRef = useRef<string | undefined>(undefined);

  const snapshot = useMemo(
    () =>
      resolveTrayNavigationSnapshot({
        activeTopics,
        agents,
        pinnedPages,
        recentPages,
        recents,
        scope,
      }),
    [activeTopics, agents, pinnedPages, recentPages, recents, scope],
  );

  const lastActiveSignatureRef = useRef(activeSignature);
  useEffect(() => {
    if (lastActiveSignatureRef.current === activeSignature) return;
    lastActiveSignatureRef.current = activeSignature;
    void refreshRecents();
  }, [activeSignature, refreshRecents]);

  useEffect(() => {
    const signature = JSON.stringify(snapshot);
    if (signature === lastSnapshotRef.current) return;
    lastSnapshotRef.current = signature;

    void desktopTrayService
      .updateNavigationSnapshot(snapshot)
      .catch((error) => console.error('Failed to synchronize tray menu:', error));
  }, [snapshot]);
};
