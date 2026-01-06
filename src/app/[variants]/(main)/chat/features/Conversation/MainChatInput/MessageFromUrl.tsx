'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useConversationStore } from '@/features/Conversation';

/**
 * MessageFromUrl
 *
 * Handles sending messages from URL query parameters.
 * Uses ConversationStore for input and send operations.
 */
const MessageFromUrl = () => {
  const [updateInputMessage, sendMessage] = useConversationStore((s) => [
    s.updateInputMessage,
    s.sendMessage,
  ]);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const message = searchParams.get('message');
    if (!message) return;

    const params = new URLSearchParams(searchParams.toString());
    params.delete('message');
    setSearchParams(params, { replace: true });

    updateInputMessage(message);
    sendMessage({ message });
  }, [searchParams, setSearchParams, updateInputMessage, sendMessage]);

  return null;
};

export default MessageFromUrl;
