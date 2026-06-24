import { useEffect, useRef } from 'react';

import { conversationSelectors, useConversationStore } from '@/features/Conversation';

import { useBuilderSuggestionFeedbackStore } from './feedbackStore';

/**
 * Watches the builder conversation for a newly sent user message and resolves
 * any pending suggestion-chip feedback against it (sent verbatim →
 * `usage_in_followup`, edited → `manual_edit`).
 *
 * Mounted in the persistent `AgentBuilderConversation` (not the welcome, which
 * unmounts on first send). Pre-existing messages at mount are ignored so only
 * genuinely new sends trigger resolution; resolution is a no-op unless a chip
 * is pending, so non-suggestion sends are unaffected.
 */
export const useResolveFeedbackOnSend = () => {
  const messages = useConversationStore(conversationSelectors.displayMessages);
  const resolveOnSend = useBuilderSuggestionFeedbackStore((s) => s.resolveOnSend);

  const initializedRef = useRef(false);
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      for (const m of messages) seenIdsRef.current.add(m.id);
      return;
    }

    const newUserMessage = messages.find((m) => m.role === 'user' && !seenIdsRef.current.has(m.id));
    for (const m of messages) seenIdsRef.current.add(m.id);

    if (newUserMessage && typeof newUserMessage.content === 'string') {
      resolveOnSend(newUserMessage.content);
    }
  }, [messages, resolveOnSend]);
};
