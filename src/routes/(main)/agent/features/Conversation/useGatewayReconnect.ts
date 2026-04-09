import useSWR from 'swr';

import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';

/**
 * Hook that detects a running Gateway operation on the current topic
 * and automatically reconnects the WebSocket after page reload.
 *
 * Uses SWR to manage the reconnect lifecycle — it only fires when
 * runningOperation exists and deduplicates by operationId.
 */
export const useGatewayReconnect = (topicId?: string | null) => {
  const isGatewayModeEnabled = useChatStore((s) => s.isGatewayModeEnabled);

  // Subscribe to topic's runningOperation — re-evaluates when topic data arrives from SWR
  const runningOperation = useChatStore((s) =>
    topicId ? topicSelectors.getTopicById(topicId)(s)?.metadata?.runningOperation : undefined,
  );

  // SWR key is the operationId — null key means no fetch
  // This naturally deduplicates: same operationId = same key = no re-fetch
  useSWR(
    runningOperation && isGatewayModeEnabled()
      ? ['reconnectGateway', runningOperation.operationId]
      : null,
    async () => {
      if (!runningOperation || !topicId) return;

      await useChatStore.getState().reconnectToGatewayOperation({
        assistantMessageId: runningOperation.assistantMessageId,
        operationId: runningOperation.operationId,
        scope: runningOperation.scope,
        threadId: runningOperation.threadId,
        topicId,
      });
    },
    {
      // Don't revalidate on focus/reconnect — one attempt is enough
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
};
