'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { useConversationStore } from '../store';
import { canConsumePendingForward } from './forwardDispatch';
import { useForwardDispatchStore } from './forwardDispatchStore';

/**
 * Drains a parked forward once the target agent's fresh conversation is the
 * active, ready one — sending the forwarded transcript as its opening turn.
 *
 * Mirrors the overlay-dispatch effect in `MessageFromUrl`: navigation updates
 * the URL before the ConversationStore context catches up, so we gate on the
 * route agentId matching the store agentId and a not-yet-created topic.
 */
const ForwardMessageDispatcher = () => {
  const [sendMessage, context] = useConversationStore((s) => [s.sendMessage, s.context]);
  const agentId = context.agentId;
  const location = useLocation();
  const isAgentConfigLoading = useAgentStore(agentSelectors.isAgentConfigLoading);
  const [pendingForward, clearPendingForward] = useForwardDispatchStore((s) => [
    s.pendingForward,
    s.clearPendingForward,
  ]);

  const routeAgentId = useMemo(() => {
    const match = location.pathname?.match(/^\/agent\/([^#/?]+)/);
    return match?.[1];
  }, [location.pathname]);

  const lastProcessedRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      !canConsumePendingForward({
        agentId,
        isAgentConfigLoading,
        pendingForward,
        routeAgentId,
        topicId: context.topicId,
      })
    ) {
      return;
    }

    if (lastProcessedRef.current === pendingForward!.dispatchId) return;
    lastProcessedRef.current = pendingForward!.dispatchId;

    const { content, dispatchId } = pendingForward!;
    clearPendingForward(dispatchId);

    void sendMessage({ message: content });
  }, [
    agentId,
    clearPendingForward,
    context.topicId,
    isAgentConfigLoading,
    pendingForward,
    routeAgentId,
    sendMessage,
  ]);

  return null;
};

export default ForwardMessageDispatcher;
