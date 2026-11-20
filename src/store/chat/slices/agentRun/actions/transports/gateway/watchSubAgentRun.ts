import type { ConversationContext } from '@lobechat/types';

import type { ChatStore } from '@/store/chat/store';

import { createGatewayEventHandler } from './gatewayEventHandler';

export interface WatchSubAgentRunParams {
  assistantMessageId: string;
  context: ConversationContext;
  operationId: string;
  token: string;
}

/**
 * Stream a sub-agent run this tab dispatched but does not drive (a direct
 * @Agent mention), so its thread fills in live instead of all at once.
 *
 * Render-only: the run's events land in `context`'s transcript, and nothing
 * on the topic is settled — the child owns no topic marker, and the
 * dispatcher's task poll owns the outcome. Joins late, so it replays what the
 * run already produced. Returns a stop that drops the subscription.
 */
export const watchSubAgentRun = (
  get: () => ChatStore,
  { assistantMessageId, context, operationId, token }: WatchSubAgentRunParams,
  gateway: { disconnect: (operationId: string) => void; gatewayUrl?: string },
): (() => void) => {
  if (!gateway.gatewayUrl || !context.topicId) return () => {};

  const { operationId: localOperationId } = get().startOperation({
    context,
    metadata: { serverOperationId: operationId },
    type: 'execServerAgentRuntime',
  });
  get().associateMessageWithOperation(assistantMessageId, localOperationId);

  const settle = () => {
    if (get().operations[localOperationId]?.status === 'running')
      get().completeOperation(localOperationId);
  };

  get().connectToGateway({
    executor: false,
    gatewayUrl: gateway.gatewayUrl,
    localOperationId,
    onEvent: createGatewayEventHandler(get, {
      assistantMessageId,
      context,
      gatewayOperationId: operationId,
      operationId: localOperationId,
    }),
    onSessionComplete: settle,
    operationId,
    resumeOnConnect: true,
    token,
    topicId: context.topicId,
  });

  return () => {
    gateway.disconnect(operationId);
    settle();
  };
};
