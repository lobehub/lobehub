import { isDesktop } from '@lobechat/const';
import { usePrevious, useUnmount } from 'ahooks';
import { use, useEffect, useLayoutEffect } from 'react';
import { useParams } from 'react-router';

import { shouldSyncGroupRoute } from '@/features/Electron/groupRouteScope';
import { TabIdContext } from '@/features/Electron/TabHost/TabIdContext';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useChatStore } from '@/store/chat';
import { useElectronStore } from '@/store/electron';

const GroupIdSync = () => {
  const tabId = use(TabIdContext);
  const activeTabId = useElectronStore((s) => s.activeTabId);
  const params = useParams<{ gid?: string; topicId?: string }>();
  const prevGroupId = usePrevious(params.gid);
  const router = useQueryRoute();
  const isActiveTab = shouldSyncGroupRoute(isDesktop, tabId, activeTabId);

  useLayoutEffect(() => {
    if (!isActiveTab) return;
    useAgentGroupStore.setState({ activeGroupId: params.gid, router });
    useChatStore.setState({ activeGroupId: params.gid });
  }, [isActiveTab, params.gid, router]);

  // Reset activeTopicId when switching to a different group
  // This prevents messages from being saved to the wrong topic bucket
  useEffect(() => {
    // Only reset topic when switching between groups (not on initial mount).
    // Preserve the topic if the URL already carries one (e.g. tab navigation).
    const isSwitchingGroup = prevGroupId !== undefined && prevGroupId !== params.gid;
    if (isActiveTab && isSwitchingGroup && !params.topicId) {
      useChatStore.getState().switchTopic(null, { skipRefreshMessage: true });
    }
  }, [isActiveTab, params.gid, params.topicId, prevGroupId]);

  // Clear activeGroupId when unmounting (leaving group page)
  useUnmount(() => {
    if (useAgentGroupStore.getState().activeGroupId === params.gid) {
      useAgentGroupStore.setState({ activeGroupId: undefined, router: undefined });
    }
    if (useChatStore.getState().activeGroupId === params.gid) {
      useChatStore.setState({ activeGroupId: undefined, activeTopicId: undefined });
    }
  });

  return null;
};

export default GroupIdSync;
