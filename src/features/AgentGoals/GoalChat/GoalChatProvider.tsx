import type { ConversationContext } from '@lobechat/types';
import type { ReactNode } from 'react';
import { memo, useEffect, useMemo, useState } from 'react';

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
  /** Open a specific conversation when entering the panel (e.g. supervision). */
  initialTopicId?: string;
}

/**
 * Scopes the goal-page side conversation to the goal's responsible agent.
 * The context carries `viewedGoal`, which makes the send path inject the goal
 * progress overview into the request (see streamingExecutor).
 */
export const GoalChatProvider = memo<GoalChatProviderProps>(
  ({ agentId, children, goalId, initialTopicId }) => {
    const [initialized, setInitialized] = useState(false);
    const setActiveAgentId = useAgentStore((s) => s.setActiveAgentId);
    const activeTopicId = useChatStore((s) => s.activeTopicId);

    useEffect(() => {
      if (!agentId) return;

      if (useAgentStore.getState().activeAgentId !== agentId) {
        setActiveAgentId(agentId);
      }

      const chatState = useChatStore.getState();
      if (chatState.activeAgentId === agentId && !initialTopicId) {
        setInitialized(true);
        return;
      }

      useChatStore.setState({ activeAgentId: agentId, activeGroupId: undefined });
      // Explicit supervision targets win over whichever conversation was open.
      // Ordinary entry into another agent starts a fresh topic.
      void chatState.switchTopic(initialTopicId ?? null, {
        skipRefreshMessage: true,
        scope: 'main',
      });
      setInitialized(true);
    }, [agentId, initialTopicId, setActiveAgentId]);

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

    if (!initialized) return null;

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
  },
);

GoalChatProvider.displayName = 'GoalChatProvider';
