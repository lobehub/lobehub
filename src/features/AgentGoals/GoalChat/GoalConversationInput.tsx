'use client';

import { memo, useEffect, useRef } from 'react';

import { type ActionKeys } from '@/features/ChatInput';
import { ChatInput, conversationSelectors, useConversationStore } from '@/features/Conversation';
import HeterogeneousChatInput from '@/routes/(main)/agent/features/Conversation/HeterogeneousChatInput';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

const LEFT_ACTIONS: ActionKeys[] = ['plus', 'voiceDictation'];
const RIGHT_ACTIONS: ActionKeys[] = ['model', 'contextWindow'];

interface GoalConversationInputProps {
  /**
   * Sent once, as soon as the conversation's history has loaded — the result
   * page's composer hands its text to the panel this way.
   */
  initialMessage?: string;
  /** Called once the handed-off message is dispatched, so the host can drop it. */
  onInitialMessageSent?: () => void;
}

/**
 * The composer under both goal-page conversations, the supervision record and
 * the side chat. It is the agent's own full input, not a trimmed strip: the goal
 * agent is often a heterogeneous one (Claude Code, Codex), whose runtime,
 * device and working directory controls live in this bar — the same choice the
 * side-by-side topic portal makes.
 */
const GoalConversationInput = memo<GoalConversationInputProps>(
  ({ initialMessage, onInitialMessageSent }) => {
    const agentId = useConversationStore(conversationSelectors.agentId);
    const isHeterogeneous = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
    const isConfigLoading = useAgentStore(agentByIdSelectors.isAgentConfigLoadingById(agentId));
    const messagesInit = useConversationStore(conversationSelectors.messagesInit);
    const sendMessage = useConversationStore((s) => s.sendMessage);

    // Waiting for the history keeps the hand-off from racing the first fetch: a
    // send while the list is still loading would go out without the record it
    // continues. The ref covers StrictMode's replayed effect within one mount;
    // across remounts the host has already dropped the message via the callback.
    const sentRef = useRef(false);
    useEffect(() => {
      if (!initialMessage || !messagesInit || sentRef.current) return;
      sentRef.current = true;
      onInitialMessageSent?.();
      void sendMessage({ message: initialMessage });
    }, [initialMessage, messagesInit, onInitialMessageSent, sendMessage]);

    if (isHeterogeneous) return <HeterogeneousChatInput />;

    return (
      <ChatInput
        skipScrollMarginWithList
        isConfigLoading={isConfigLoading}
        leftActions={LEFT_ACTIONS}
        rightActions={RIGHT_ACTIONS}
        sendButtonProps={{ shape: 'round' }}
      />
    );
  },
);

GoalConversationInput.displayName = 'GoalConversationInput';

export default GoalConversationInput;
