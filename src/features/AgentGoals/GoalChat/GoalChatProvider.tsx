import type { ConversationContext } from '@lobechat/types';
import type { ReactNode } from 'react';
import { memo, useEffect, useMemo, useState } from 'react';

import { PinnedTopicContext } from '@/features/ChatInput/InputEditor/ReferTopic/pinnedTopic';
import { ConversationProvider } from '@/features/Conversation';
import { useGatewayReconnect } from '@/hooks/useGatewayReconnect';
import { useOperationState } from '@/hooks/useOperationState';
import { useTopicRunEvents } from '@/hooks/useTopicRunEvents';
import { useAgentStore } from '@/store/agent';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

interface GoalChatProviderProps {
  /** The goal's responsible agent — the one the user asks about progress. */
  agentId: string;
  children: ReactNode;
  goalId: string;
  /** Open a specific conversation when entering the panel (e.g. supervision). */
  initialTopicId?: string;
  /**
   * The goal is bound to `initialTopicId`: nothing inside the panel may switch
   * it to another topic (a topic reference opens in the portal instead).
   */
  pinned?: boolean;
}

/**
 * Scopes the goal-page side conversation to the goal's responsible agent.
 * The context carries `viewedGoal`, which makes the send path inject the goal
 * progress overview into the request (see streamingExecutor).
 */
export const GoalChatProvider = memo<GoalChatProviderProps>(
  ({ agentId, children, goalId, initialTopicId, pinned }) => {
    const [initialized, setInitialized] = useState(false);
    const setActiveAgentId = useAgentStore((s) => s.setActiveAgentId);
    const activeTopicId = useChatStore((s) => s.activeTopicId);
    const activeChatAgentId = useChatStore((s) => s.activeAgentId);

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

    const operationState = useOperationState(context);

    // Follow a run still going on this topic, as the agent page does: a page
    // that opens here after a reload or in a new window has no local operation
    // for it, so without this the composer reads idle and the next message
    // starts a second run that discards the live one (and kills its CLI).
    // Only once the store points at this panel's conversation: until the
    // switch above lands, `activeTopicId` is whatever was open before, and its
    // run would be followed under this panel's agent.
    const followedTopicId =
      initialized &&
      activeChatAgentId === agentId &&
      (!initialTopicId || activeTopicId === initialTopicId)
        ? activeTopicId
        : undefined;
    const runningOperation = useChatStore((s) =>
      followedTopicId
        ? topicSelectors.getTopicById(followedTopicId)(s)?.metadata?.runningOperation
        : undefined,
    );
    useGatewayReconnect(followedTopicId, runningOperation, agentId);
    useTopicRunEvents(followedTopicId, agentId);

    if (!initialized) return null;

    return (
      <PinnedTopicContext value={pinned ? initialTopicId : undefined}>
        <ConversationProvider context={context} operationState={operationState}>
          {children}
        </ConversationProvider>
      </PinnedTopicContext>
    );
  },
);

GoalChatProvider.displayName = 'GoalChatProvider';
