import { type MessageReadQueryContext, messageService } from '@/services/message';
import { getAgentStoreState } from '@/store/agent';

import { resolveGatewayModeEnabled } from './gatewayMode';
import { canUseGatewayProtocolV2 } from './gatewayProtocol';

/**
 * The conversation-list read every rendering surface shares.
 *
 * It asks for projected tool payloads (`@lobechat/tool-view-model`) only for a
 * protocol-v2 client whose runs execute on the server. Both halves matter:
 *
 * - Protocol v2 is what the projection ships with, so it moves with the same
 *   rollout dial rather than reaching everyone the moment this code deploys.
 * - Gateway mode is the correctness half. Off it, the run executes in the
 *   browser and assembles its LLM context from the very list this read fills
 *   (`dbMessagesMap` → `ClientMessageTransport`), so a projected tool result
 *   would silently vanish from the model's view of its own work. Whole payloads
 *   are the answer that cannot lose data, so that is what an unknown or
 *   client-side agent gets.
 *
 * The choice deliberately stays out of the message-list cache key: a list
 * cached while Gateway mode was on can still be read by a run the user has
 * since switched to the browser, which is why `ClientMessageTransport` refills
 * omitted payloads before building a context rather than trusting this gate.
 */
export const readConversationMessages = (
  context: MessageReadQueryContext,
): Promise<Awaited<ReturnType<typeof messageService.getMessages>>> =>
  messageService.getMessages({
    ...context,
    projectToolPayloads:
      canUseGatewayProtocolV2() &&
      resolveGatewayModeEnabled(getAgentStoreState(), context.agentId ?? undefined),
  });
