'use client';

import isEqual from 'fast-deep-equal';
import { useEffect, useMemo, useRef } from 'react';

import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { desktopTrayService } from '@/services/electron/tray';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/slices/agentList/selectors';
import { TRAY_RECENTS_PARAMS } from '@/store/home/slices/recent/action';
import { createRecentQueryKey } from '@/store/home/slices/recent/initialState';
import { homeRecentSelectors } from '@/store/home/slices/recent/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import { useResolvedPages } from '../RecentlyViewed/hooks/useResolvedPages';
import { resolveTrayNavigationSnapshot } from './resolveSnapshot';
import { selectActiveTopics } from './selectActiveTopics';

const TRAY_RECENTS_KEY = createRecentQueryKey(TRAY_RECENTS_PARAMS.limit, {
  types: TRAY_RECENTS_PARAMS.types,
  view: TRAY_RECENTS_PARAMS.view,
});

export const useTrayMenuSync = () => {
  useFetchAgentList();
  const agents = useHomeStore(homeAgentListSelectors.allAgents);
  const scope = useElectronStore((state) => state.activeRecentScope);
  const { pinnedPages, recentPages } = useResolvedPages();
  const activeTopics = useChatStore(selectActiveTopics, isEqual);
  const isLogin = useUserStore(authSelectors.isLogin);
  // The `recentList` replica: a restart paints the last tray rows before the
  // network answers.
  const useFetchTrayRecents = useHomeStore((s) => s.useFetchTrayRecents);
  const { revalidate: refreshRecents } = useFetchTrayRecents(!!isLogin);
  const recents = useHomeStore(homeRecentSelectors.query(TRAY_RECENTS_KEY));
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
