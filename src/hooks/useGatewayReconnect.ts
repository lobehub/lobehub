import useSWR from 'swr';

import { useChatStore } from '@/store/chat';
import { useServerConfigStore } from '@/store/serverConfig';

interface RunningOperation {
  assistantMessageId: string;
  operationId: string;
  scope?: string;
  threadId?: string | null;
}

/**
 * Auto-reconnect to a running Gateway operation on the given topic.
 *
 * The caller sources `runningOperation` itself — the chat-store topic map
 * (main agent) and the task-detail activity (task drawer) live in different
 * stores, so this hook stays source-agnostic.
 *
 * Reconnect only depends on whether the server has a Gateway URL configured;
 * the user's lab toggle controls *new* requests, not resuming an op that's
 * already running on the Gateway.
 *
 * SWR key is the operationId, so the same operation deduplicates and only
 * one reconnect attempt fires per op.
 */
export const useGatewayReconnect = (
  topicId: string | null | undefined,
  runningOperation: RunningOperation | null | undefined,
) => {
  const agentGatewayUrl = useServerConfigStore((s) => s.serverConfig.agentGatewayUrl);

  useSWR(
    runningOperation && topicId && agentGatewayUrl
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
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
};
