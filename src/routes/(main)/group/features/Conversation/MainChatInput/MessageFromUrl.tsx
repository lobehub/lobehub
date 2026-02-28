'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useConversationStore } from '@/features/Conversation';

/**
 * MessageFromUrl
 *
 * Handles sending messages from URL query parameters.
 * Uses ConversationStore for input and send operations.
 */
const MessageFromUrl = () => {
  const [sendMessage, agentId] = useConversationStore((s) => [s.sendMessage, s.context.agentId]);
  const [searchParams, setSearchParams] = useSearchParams();

  // Track if we've processed the initial message to prevent duplicate sends
  const hasProcessedRef = useRef(false);

  useEffect(() => {
    // Only process once
    if (hasProcessedRef.current) return;

    const message = searchParams.get('message');
    if (!message) return;

    // Wait for agentId to be available before sending
    if (!agentId) return;

    hasProcessedRef.current = true;

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
  }, [searchParams, setSearchParams, sendMessage, agentId]);

  return null;
};

export default MessageFromUrl;
