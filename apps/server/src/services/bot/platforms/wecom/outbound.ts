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
 * Waits between attempts while the gateway does not hold the bot's connection. A gateway restart
 * (deploy) drops every connection and re-registers them from lobehub's desired set, which took
 * ~30 s in production (T-14145); a reply that lands in that window must wait for it, not be lost.
 * About a minute in total, well inside the callback's function budget.
 */
export const WECOM_GATEWAY_RETRY_DELAYS_MS = [2000, 4000, 8000, 15_000, 15_000, 15_000];

const NOT_HELD_DETAIL = /not connected|connection closed|socket is not open/i;

/**
 * Whether a failed send means "the gateway does not hold a live connection right now": a 404 (no
 * such connection), the gateway's own "not connected" / "connection closed" refusal, or no answer
 * from the gateway at all. In all of these the reply did not reach the user, so waiting for the
 * connection to come back and sending again is the only way it ever arrives. A rejection from
 * WeCom itself is not retried.
 */
export const isConnectionNotHeldError = (error: unknown): boolean => {
  if (error instanceof MessageGatewaySendError) {
    return error.status === 404 || (error.status >= 500 && NOT_HELD_DETAIL.test(error.message));
  }
  // `fetch` itself failed: the gateway is down or restarting.
  return error instanceof TypeError;
};

export interface GatewayWeComOutboundOptions {
  retryDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Replies through the Node message gateway, which holds the bot's long connection and keeps its
 * reply state (each conversation's latest req_id and open stream) next to the socket.
 */
export const createGatewayWeComOutbound = (
  botId: string,
  {
    retryDelaysMs = WECOM_GATEWAY_RETRY_DELAYS_MS,
    sleep = defaultSleep,
  }: GatewayWeComOutboundOptions = {},
): WeComOutbound => ({
  deliver: async (thread, text) => {
    const client = getMessageGatewayClient(PLATFORM);
    const platformThreadId = encodeThreadId(thread);
    const send = async (connectionId: string) => {
      const { messageId } = await client.sendText(connectionId, platformThreadId, text);
      return { id: messageId ?? '' };
    };

    let connectionId = await resolveConnectionId(botId);
    for (let attempt = 0; ; attempt++) {
      try {
        return await send(connectionId);
      } catch (error) {
        if (!isConnectionNotHeldError(error)) throw error;
        // The bot may have been recreated under the same BotID: its connection then has a new id,
        // worth trying right away.
        const fresh = await resolveConnectionId(botId, true);
        if (attempt >= retryDelaysMs.length) throw error;
        if (fresh !== connectionId) {
          connectionId = fresh;
          continue;
        }
        log(
          'deliver: the gateway does not hold %s (attempt %d), retrying in %dms: %O',
          botId,
          attempt + 1,
          retryDelaysMs[attempt],
          error,
        );
        await sleep(retryDelaysMs[attempt]);
      }
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
