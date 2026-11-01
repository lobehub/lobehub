import { usePrevious } from 'ahooks';
import { useEffect, useLayoutEffect } from 'react';

import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';

interface AgentIdStoreSyncOptions {
  activeId?: string;
  topicFromPath?: string;
  topicFromQuery?: string | null;
}

export const useAgentIdStoreSync = ({
  activeId,
  topicFromPath,
  topicFromQuery,
}: AgentIdStoreSyncOptions) => {
  const previousAgentId = usePrevious(activeId);

  useLayoutEffect(() => {
    if (!activeId) return;

    if (useAgentStore.getState().activeAgentId !== activeId) {
      useAgentStore.setState({ activeAgentId: activeId }, false, 'AgentIdSync/syncAgentId');
    }
    if (useChatStore.getState().activeAgentId !== activeId) {
      useChatStore.setState({ activeAgentId: activeId }, false, 'AgentIdSync/syncAgentId');
    }
  }, [activeId]);

  useEffect(() => {
    if (previousAgentId === undefined || previousAgentId === activeId) return;

    useChatStore.getState().clearPortalStack();
    if (!topicFromPath && !topicFromQuery) {
      useChatStore.getState().switchTopic(null, { skipRefreshMessage: true });
    }
  }, [activeId, previousAgentId, topicFromPath, topicFromQuery]);

  useLayoutEffect(
    () => () => {
      useAgentStore.setState({ activeAgentId: undefined }, false, 'AgentIdSync/unmountAgentId');
      useChatStore.setState(
        { activeAgentId: undefined, activeTopicId: undefined },
        false,
        'AgentIdSync/unmountAgentId',
      );
    },
    [],
  );
};
