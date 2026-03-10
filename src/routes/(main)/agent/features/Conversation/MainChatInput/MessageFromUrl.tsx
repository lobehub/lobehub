'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

import { useConversationStore } from '@/features/Conversation';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

/**
 * MessageFromUrl
 *
 * Handles sending messages from URL query parameters.
 * Uses ConversationStore for input and send operations.
 */
const MessageFromUrl = () => {
  const [sendMessage, context, messagesInit] = useConversationStore((s) => [
    s.sendMessage,
    s.context,
    s.messagesInit,
  ]);
  const agentId = context.agentId;
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const isAgentConfigLoading = useAgentStore(agentSelectors.isAgentConfigLoading);

  const routeAgentId = useMemo(() => {
    const match = location.pathname?.match(/^\/agent\/([^#/?]+)/);
    return match?.[1];
  }, [location.pathname]);

  // Track last processed (agentId, message) to prevent duplicate sends on re-render,
  // while still allowing sending when navigating to a different agent (or message).
  const lastProcessedSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    const message = searchParams.get('message');
    if (!message) return;

    // Wait for agentId to be available before sending
    if (!agentId) return;

    // During agent switching, URL/searchParams may update before ConversationStore context updates.
    // Only consume the param when the route agentId matches the ConversationStore agentId.
    if (routeAgentId && routeAgentId !== agentId) return;

    // Ensure required agent info is loaded before consuming the param.
    // For existing conversations (topicId exists), also wait until messages are initialized
    // to avoid sending during skeleton fetch states.
    const isNewConversation = !context.topicId;
    const isReady = !isAgentConfigLoading && (isNewConversation || messagesInit);
    if (!isReady) return;

    const signature = `${agentId}::${message}`;
    if (lastProcessedSignatureRef.current === signature) return;
    lastProcessedSignatureRef.current = signature;

    // Use functional update to safely remove message param without affecting other params
    setSearchParams(
      (prev) => {
        const newParams = new URLSearchParams(prev);
        newParams.delete('message');
        return newParams;
      },
      { replace: true },
    );

    // Send the message
    sendMessage({ message });
  }, [
    searchParams,
    setSearchParams,
    sendMessage,
    agentId,
    context.topicId,
    isAgentConfigLoading,
    messagesInit,
    routeAgentId,
  ]);

  return null;
};

export default MessageFromUrl;
