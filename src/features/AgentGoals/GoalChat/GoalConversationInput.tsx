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
   * Handed over once the conversation is ready — the result page's composer
   * passes its text to the panel this way. A standard agent sends it right
   * away; a heterogeneous one gets it filled into its composer instead.
   */
  initialMessage?: string;
  /** Called once the handed-off message is sent or filled in, so the host can drop it. */
  onInitialMessageConsumed?: () => void;
}

/**
 * The composer under both goal-page conversations, the supervision record and
 * the side chat. It is the agent's own full input, not a trimmed strip: the goal
 * agent is often a heterogeneous one (Claude Code, Codex), whose runtime,
 * device and working directory controls live in this bar — the same choice the
 * side-by-side topic portal makes.
 */
const GoalConversationInput = memo<GoalConversationInputProps>(
  ({ initialMessage, onInitialMessageConsumed }) => {
    const agentId = useConversationStore(conversationSelectors.agentId);
    const isHeterogeneous = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
    const isConfigLoading = useAgentStore(agentByIdSelectors.isAgentConfigLoadingById(agentId));
    const messagesInit = useConversationStore(conversationSelectors.messagesInit);
    const sendMessage = useConversationStore((s) => s.sendMessage);
    const fillInputMessage = useConversationStore((s) => s.fillInputMessage);
    const editor = useConversationStore((s) => s.editor);

    // Waiting for the history keeps the hand-off from racing the first fetch: a
    // send while the list is still loading would go out without the record it
    // continues. Waiting for the agent config keeps a heterogeneous agent from
    // being mistaken for a standard one while it hydrates.
    //
    // A heterogeneous agent's composer gates sending on readiness it alone
    // knows — API binding, execution target, device online — so the message is
    // filled in for it to send rather than dispatched around those guards.
    //
    // The ref covers StrictMode's replayed effect within one mount; across
    // remounts the host has already dropped the message via the callback.
    const handedOffRef = useRef(false);
    useEffect(() => {
      if (!initialMessage || !messagesInit || isConfigLoading || handedOffRef.current) return;
      if (isHeterogeneous) {
        if (!editor) return;
        handedOffRef.current = true;
        onInitialMessageConsumed?.();
        fillInputMessage(initialMessage);
        return;
      }
      handedOffRef.current = true;
      onInitialMessageConsumed?.();
      void sendMessage({ message: initialMessage });
    }, [
      editor,
      fillInputMessage,
      initialMessage,
      isConfigLoading,
      isHeterogeneous,
      messagesInit,
      onInitialMessageConsumed,
      sendMessage,
    ]);

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
