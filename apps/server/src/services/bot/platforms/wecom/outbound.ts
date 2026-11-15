import type { WeComOutbound, WeComThreadId } from '@lobechat/chat-adapter-wecom';
import { createInProcessWeComOutbound } from '@lobechat/chat-adapter-wecom';
import debug from 'debug';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import {
  getMessageGatewayClient,
  MessageGatewaySendError,
} from '@/server/services/gateway/MessageGatewayClient';
import { resolveReplyConnectionHost } from '@/server/services/gateway/replyConnectionHost';

const log = debug('bot-platform:wecom:outbound');

const PLATFORM = 'wecom';

const encodeThreadId = (thread: WeComThreadId): string => `${PLATFORM}:${thread.type}:${thread.id}`;

/**
 * Gateway connection id per BotID. The gateway keys connections by the provider row id, which a
 * reply path does not carry; looking it up on every reply would add a DB round trip to each one.
 */
const connectionIds = new Map<string, string>();

const resolveConnectionId = async (botId: string, refresh = false): Promise<string> => {
  if (!refresh) {
    const cached = connectionIds.get(botId);
    if (cached) return cached;
  }
  const row = await AgentBotProviderModel.findByPlatformAndAppId(
    await getServerDB(),
    PLATFORM,
    botId,
  );
  if (!row?.id) throw new Error(`No WeCom bot is configured for BotID ${botId}`);
  connectionIds.set(botId, row.id);
  return row.id;
};

/** Test hook: forget cached connection ids. */
export const resetWeComGatewayConnectionIds = (): void => connectionIds.clear();

/**
 * Replies through the Node message gateway, which holds the bot's long connection and keeps its
 * reply state (each conversation's latest req_id and open stream) next to the socket.
 */
export const createGatewayWeComOutbound = (botId: string): WeComOutbound => ({
  deliver: async (thread, text) => {
    const client = getMessageGatewayClient(PLATFORM);
    const platformThreadId = encodeThreadId(thread);
    const send = async (connectionId: string) => {
      const { messageId } = await client.sendText(connectionId, platformThreadId, text);
      return { id: messageId ?? '' };
    };

    const connectionId = await resolveConnectionId(botId);
    try {
      return await send(connectionId);
    } catch (error) {
      // The bot was recreated under the same BotID: its connection now has a new id.
      if (!(error instanceof MessageGatewaySendError) || error.status !== 404) throw error;
      const fresh = await resolveConnectionId(botId, true);
      if (fresh === connectionId) throw error;
      return send(fresh);
    }
  },
  openStream: async (thread) => {
    try {
      const connectionId = await resolveConnectionId(botId);
      await getMessageGatewayClient(PLATFORM).startTyping(connectionId, encodeThreadId(thread));
    } catch (error) {
      log('openStream via gateway failed for %s: %O', botId, error);
    }
  },
});

/** Where this deployment's WeCom replies go out: the gateway that holds the bot, or this process. */
export const resolveWeComOutbound = (botId: string): WeComOutbound =>
  resolveReplyConnectionHost(PLATFORM) === 'message-gateway'
    ? createGatewayWeComOutbound(botId)
    : createInProcessWeComOutbound(botId);
