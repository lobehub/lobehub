'use client';

import { memo, useEffect } from 'react';

import { type ChatSyncScope, subscribeChatSync, suppressBroadcast } from '@/libs/crossWindowBus';
import { useChatStore } from '@/store/chat';

/**
 * Subscribes to the cross-window sync bus and revalidates local SWR caches
 * when a sibling window reports a chat/topic mutation.
 *
 * Mount once at the SPA root so every window (main + popup) participates.
 */
const CrossWindowSync = memo(() => {
  useEffect(() => {
    const scopeMatchesCurrent = (scope: ChatSyncScope): boolean => {
      const { activeAgentId, activeGroupId } = useChatStore.getState();
      // Prefer groupId match when scope carries one, otherwise fall back to
      // agentId match. Empty/undefined on either side counts as a wildcard.
      if (scope.groupId) return scope.groupId === activeGroupId;
      if (scope.agentId) return scope.agentId === activeAgentId;
      return true;
    };

    return subscribeChatSync({
      onMessagesMutation: (scope) => {
        if (!scopeMatchesCurrent(scope)) return;
        void suppressBroadcast(() =>
          useChatStore.getState().refreshMessages({
            agentId: scope.agentId,
            groupId: scope.groupId,
            topicId: scope.topicId,
          }),
        );
      },
      onTopicsMutation: (scope) => {
        if (!scopeMatchesCurrent(scope)) return;
        void suppressBroadcast(() => useChatStore.getState().refreshTopic());
      },
    });
  }, []);

  return null;
});

CrossWindowSync.displayName = 'CrossWindowSync';

export default CrossWindowSync;
