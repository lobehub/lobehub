'use client';

import { useAnalytics } from '@lobehub/analytics/react';
import { memo, useCallback, useEffect } from 'react';

import { getChatStoreState } from '@/store/chat';
import { displayMessageSelectors } from '@/store/chat/selectors';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { getSessionStoreState } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';

const MainInterfaceTracker = memo(() => {
  const { analytics } = useAnalytics();

  const getMainInterfaceAnalyticsData = useCallback(() => {
    const currentSession = sessionSelectors.currentSession(getSessionStoreState());
    const activeSessionId = currentSession?.id;
    const defaultSessions = sessionSelectors.defaultSessions(getSessionStoreState());
    const showRightPanel = systemStatusSelectors.showRightPanel(useGlobalStore.getState());
    const messages = displayMessageSelectors.activeDisplayMessages(getChatStoreState());
    return {
      active_assistant: activeSessionId === 'inbox' ? null : currentSession?.meta?.title || null,
      has_chat_history: messages.length > 0,
      session_id: activeSessionId ? activeSessionId : 'inbox',
      sidebar_state: showRightPanel ? 'expanded' : 'collapsed',
      visible_assistants_count: defaultSessions.length,
    };
  }, []);

  useEffect(() => {
    if (!analytics) return;

    const timer = setTimeout(() => {
      analytics.track({
        name: 'main_page_view',
        properties: {
          ...getMainInterfaceAnalyticsData(),
          spm: 'main_page.interface.view',
        },
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [analytics, getMainInterfaceAnalyticsData]);

  return null;
});

MainInterfaceTracker.displayName = 'MainInterfaceTracker';

export default MainInterfaceTracker;
