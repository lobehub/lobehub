import type { ConversationContext } from '@lobechat/types';
import { useEffect, useRef } from 'react';

import { useChatStore } from '@/store/chat';
import { restoreServerQueuedMessages } from '@/store/chat/slices/agentRun/actions/transports/gateway/serverSteerQueue';

/**
 * Show the follow-ups still queued on the server for this conversation when it
 * opens — also when nothing runs, e.g. after a queued next turn failed to
 * start and they went back to the queue. A running conversation reloads them
 * on reconnect as well; both add each follow-up once.
 */
export const useRestoreServerQueue = (context: ConversationContext, enabled: boolean) => {
  const { agentId, threadId, topicId } = context;
  // Read once per conversation: the object's identity changes on unrelated updates.
  const contextRef = useRef(context);
  contextRef.current = context;
  useEffect(() => {
    if (!enabled || !agentId || !topicId || threadId) return;
    void restoreServerQueuedMessages(useChatStore.getState, contextRef.current);
  }, [enabled, agentId, threadId, topicId]);
};
