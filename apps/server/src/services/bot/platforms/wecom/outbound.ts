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

/**
 * Refusals raised before any frame is written: the gateway has no live socket for the bot, or the
 * connection refuses to enqueue. Not "connection closed": a socket that drops while a frame waits
 * for its receipt may already have delivered it.
 */
const NOT_SENT_DETAIL = /is not connected|socket is not open/i;

/** `fetch` failed while connecting, so the request never reached the gateway. */
const CONNECT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
]);

const connectErrorCode = (error: TypeError): string | undefined => {
  const cause = (error as { cause?: { code?: unknown } }).cause;
  return typeof cause?.code === 'string' ? cause.code : undefined;
};

/**
 * Whether a failed send is known to have sent nothing because the gateway does not hold a live
 * connection right now: a 404 (no such connection), the "not connected" refusal raised before a
 * frame is written, or a gateway that could not be reached at all. Only these are retried —
 * `sendText` carries no idempotency key, so a failure that may have reached WeCom (a lost receipt,
 * a reset mid-request) is surfaced instead of risking a duplicate reply. A rejection from WeCom
 * itself is not retried either.
 */
export const isConnectionNotHeldError = (error: unknown): boolean => {
  if (error instanceof MessageGatewaySendError) {
    return error.status === 404 || (error.status >= 500 && NOT_SENT_DETAIL.test(error.message));
  }
  if (error instanceof TypeError) {
    const code = connectErrorCode(error);
    return !!code && CONNECT_ERROR_CODES.has(code);
  }
  return false;
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
        // worth trying right away — even once the backoff budget is spent, but only once past it.
        const fresh = await resolveConnectionId(botId, true);
        if (fresh !== connectionId && attempt <= retryDelaysMs.length) {
          connectionId = fresh;
          continue;
        }
        if (attempt >= retryDelaysMs.length) throw error;
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
