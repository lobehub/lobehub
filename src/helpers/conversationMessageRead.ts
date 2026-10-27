import { type MessageReadQueryContext, messageService } from '@/services/message';

import { canUseGatewayProtocolV2 } from './gatewayProtocol';

/**
 * The conversation-list read every rendering surface shares.
 *
 * It asks for projected tool payloads (`@lobechat/tool-view-model`) only for a
 * protocol-v2 client: the projection ships with protocol v2, so it moves with
 * the same rollout dial rather than reaching everyone the moment this code
 * deploys. The browser never assembles an LLM context from this list (agent
 * runs execute on the server), so a projected tool result cannot drop out of a
 * model's view.
 */
const withConversationReadOptions = (
  context: MessageReadQueryContext,
): MessageReadQueryContext => ({
  ...context,
  projectToolPayloads: canUseGatewayProtocolV2(),
});

export const readConversationMessages = (
  context: MessageReadQueryContext,
): Promise<Awaited<ReturnType<typeof messageService.getMessages>>> =>
  messageService.getMessages(withConversationReadOptions(context));

/**
 * The paged form of {@link readConversationMessages}, for the message-list
 * cache: the newest round-cursor window of a topic, or the plain list for other
 * contexts. Same projection gate.
 */
export const readConversationMessageListPage = (
  context: MessageReadQueryContext,
): ReturnType<typeof messageService.getMessageListPage> =>
  messageService.getMessageListPage(withConversationReadOptions(context));
