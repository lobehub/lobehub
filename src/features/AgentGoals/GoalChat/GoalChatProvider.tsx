import type { ConversationContext } from '@lobechat/types';
import type { ReactNode } from 'react';
import { memo, useEffect, useMemo } from 'react';

import { ConversationProvider } from '@/features/Conversation';
import { useOperationState } from '@/hooks/useOperationState';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

interface GoalChatProviderProps {
  /** The goal's responsible agent — the one the user asks about progress. */
  agentId: string;
  children: ReactNode;
  goalId: string;
}

/**
 * Scopes the goal-page side conversation to the goal's responsible agent.
 * The context carries `viewedGoal`, which makes the send path inject the goal
 * progress overview into the request (see streamingExecutor).
 */
export const GoalChatProvider = memo<GoalChatProviderProps>(({ agentId, children, goalId }) => {
  const setActiveAgentId = useAgentStore((s) => s.setActiveAgentId);
  const activeTopicId = useChatStore((s) => s.activeTopicId);

  useEffect(() => {
    if (!agentId) return;

    if (useAgentStore.getState().activeAgentId !== agentId) {
      setActiveAgentId(agentId);
    }

    const chatState = useChatStore.getState();
    if (chatState.activeAgentId === agentId) return;

    useChatStore.setState({ activeAgentId: agentId });
    // Entering the goal page mid-way through another agent's conversation:
    // start from a fresh topic rather than showing that unrelated thread.
    void chatState.switchTopic(null, { skipRefreshMessage: true });
  }, [agentId, setActiveAgentId]);

  const context = useMemo<ConversationContext>(
    () => ({
      agentId,
      topicId: activeTopicId,
      viewedGoal: { goalId },
    }),
    [activeTopicId, agentId, goalId],
  );

  const chatKey = useMemo(() => messageMapKey(context), [context]);
  const replaceMessages = useChatStore((s) => s.replaceMessages);
  const messages = useChatStore((s) => s.dbMessagesMap[chatKey]);
  const operationState = useOperationState(context);

  return (
    <ConversationProvider
      context={context}
      hasInitMessages={!!messages}
      messages={messages}
      operationState={operationState}
      onMessagesChange={(msgs, ctx, meta) => {
        replaceMessages(msgs, { context: ctx, source: meta?.source });
      }}
    >
      {children}
    </ConversationProvider>
  );
});

GoalChatProvider.displayName = 'GoalChatProvider';
