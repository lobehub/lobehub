'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';

import { useConversationStore } from '@/features/Conversation';
import { useConversationResourceAccess } from '@/features/Conversation/hooks/useConversationResourceAccess';
import { usePermission } from '@/hooks/usePermission';

/**
 * MessageFromUrl
 *
 * Handles sending messages from URL query parameters.
 * Uses ConversationStore for input and send operations.
 */
const MessageFromUrl = () => {
  const [sendMessage, agentId] = useConversationStore((s) => [s.sendMessage, s.context.agentId]);
  const [searchParams, setSearchParams] = useSearchParams();
  const { allowed: canCreate } = usePermission('create_content');
  // Per-resource General access: view-only members must not auto-send into a
  // shared group, whatever the URL says. Wait for the settled value — the
  // permissive loading default would otherwise let the send race through.
  const { canUseResource, isAccessLoading } = useConversationResourceAccess();

  // Track if we've processed the initial message to prevent duplicate sends
  const hasProcessedRef = useRef(false);

  useEffect(() => {
    // Only process once
    if (hasProcessedRef.current) return;

    const message = searchParams.get('message');
    if (!message) return;

    // Wait for agentId to be available before sending
    if (!agentId) return;

    if (!canCreate) return;
    if (isAccessLoading) return;

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

    // View-only: consume the param (so it doesn't linger in the URL) but never send.
    if (!canUseResource) return;

    // Send the message
    sendMessage({ message });
  }, [
    searchParams,
    setSearchParams,
    sendMessage,
    agentId,
    canCreate,
    canUseResource,
    isAccessLoading,
  ]);

  return null;
};

export default MessageFromUrl;
