import { WechatApiClient } from '@lobechat/chat-adapter-wechat';
import debug from 'debug';

import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import type { LobeChatDatabase } from '@/database/type';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import type {
  WechatPendingPush,
  WechatWindowRedis,
} from '@/server/services/bot/platforms/wechat/contextWindow';
import {
  consumeSendCredits,
  drainPendingPushes,
  enqueuePendingPush,
  peekWindow,
  pendingPushSendCount,
  WECHAT_WINDOW_MAX_SENDS,
  wechatPendingPushKey,
  wechatWindowKey,
} from '@/server/services/bot/platforms/wechat/contextWindow';
import type { WechatOutboundAttachment } from '@/server/services/bot/platforms/wechat/sendAttachments';
import { sendWechatAttachments } from '@/server/services/bot/platforms/wechat/sendAttachments';

const log = debug('lobe-server:messenger:wechat-push');

/**
 * Credits kept in reserve when replaying queued pushes on an inbound message:
 * the user just messaged us expecting a reply, and the reply path itself
 * consumes window quota — never let the backlog starve the live conversation.
 */
const RESERVED_REPLY_CREDITS = 2;

export type WechatPushStatus =
  /** Delivered inside the current send window. */
  | 'sent'
  /** Window closed or quota exhausted — queued for the next inbound message. */
  | 'queued'
  /** The user has no usable WeChat account link. */
  | 'unlinked'
  /** Redis (window state) is unavailable — cannot deliver or queue. */
  | 'unavailable';

export interface WechatPushResult {
  /** Remaining locally tracked sends after delivery (only for `sent`). */
  remaining?: number;
  status: WechatPushStatus;
}

interface WechatCredentialsBlob {
  baseUrl?: string;
  botId?: string;
  botToken?: string;
}

interface ResolvedWechatTarget {
  api: WechatApiClient;
  applicationId: string;
  platformUserId: string;
}

const resolveWechatTarget = async (
  serverDB: LobeChatDatabase,
  userId: string,
): Promise<ResolvedWechatTarget | null> => {
  const linkModel = new MessengerAccountLinkModel(serverDB, userId);
  const safeLink = await linkModel.findByPlatform('wechat');
  if (!safeLink?.applicationId) return null;

  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const link = await linkModel.findByIdWithCredentials(safeLink.id, 'wechat', gateKeeper);
  if (!link) return null;

  const blob = link.credentials as WechatCredentialsBlob;
  if (!blob?.botToken) {
    log('resolveWechatTarget: link %s has incomplete credentials', link.id);
    return null;
  }

  return {
    api: new WechatApiClient(blob.botToken, blob.botId, blob.baseUrl),
    applicationId: link.applicationId!,
    platformUserId: link.platformUserId,
  };
};

const deliver = async (
  api: WechatApiClient,
  platformUserId: string,
  token: string,
  payload: Pick<WechatPendingPush, 'attachments' | 'content'>,
): Promise<void> => {
  if (payload.content?.trim()) {
    await api.sendMessage(platformUserId, payload.content, token);
  }
  if (payload.attachments?.length) {
    await sendWechatAttachments(api, platformUserId, payload.attachments, token);
  }
};

export interface WechatPushWindowStatus {
  /** Seconds until the current window expires; null when no window is open. */
  expiresInSeconds: number | null;
  linked: boolean;
  maxSends: number;
  /** Proactive messages waiting for the next inbound message. */
  queued: number;
  remaining: number;
  windowOpen: boolean;
}

const CLOSED_WINDOW: Omit<WechatPushWindowStatus, 'linked' | 'queued'> = {
  expiresInSeconds: null,
  maxSends: WECHAT_WINDOW_MAX_SENDS,
  remaining: 0,
  windowOpen: false,
};

/**
 * Read-only send-window status for the current user's WeChat link — powers the
 * messenger settings UI (remaining quota, expiry, queued backlog). Uses the
 * safe link projection only; no credential decryption happens here.
 */
export const getWechatPushWindowStatus = async (params: {
  serverDB: LobeChatDatabase;
  userId: string;
}): Promise<WechatPushWindowStatus> => {
  const linkModel = new MessengerAccountLinkModel(params.serverDB, params.userId);
  const link = await linkModel.findByPlatform('wechat');
  if (!link?.applicationId) return { ...CLOSED_WINDOW, linked: false, queued: 0 };

  const redis = getAgentRuntimeRedisClient() as WechatWindowRedis | null;
  if (!redis) return { ...CLOSED_WINDOW, linked: true, queued: 0 };

  const applicationId = link.applicationId;
  const platformUserId = link.platformUserId;

  const sendWindow = await peekWindow(redis, applicationId, platformUserId);
  const [queued, ttl] = await Promise.all([
    redis.llen(wechatPendingPushKey(applicationId, platformUserId)),
    sendWindow ? redis.ttl(wechatWindowKey(applicationId, platformUserId)) : Promise.resolve(-1),
  ]);

  if (!sendWindow) return { ...CLOSED_WINDOW, linked: true, queued };

  return {
    expiresInSeconds: ttl > 0 ? ttl : null,
    linked: true,
    maxSends: WECHAT_WINDOW_MAX_SENDS,
    queued,
    remaining: Math.max(0, sendWindow.remaining),
    windowOpen: sendWindow.remaining > 0,
  };
};

/**
 * Proactively push a message to a LobeHub user's linked WeChat account.
 *
 * WeChat iLink offers no bot-initiated conversation API, so delivery is only
 * possible inside the current send window (a `context_token` from a recent
 * inbound message with quota left). Outside the window the message is queued
 * and replayed automatically the next time the user messages the bot — the
 * caller gets an honest `queued` instead of a silent failure.
 */
export const sendProactiveWechatMessage = async (params: {
  attachments?: WechatOutboundAttachment[];
  content?: string;
  serverDB: LobeChatDatabase;
  userId: string;
}): Promise<WechatPushResult> => {
  const { serverDB, userId, content, attachments } = params;
  if (!content?.trim() && !attachments?.length) return { status: 'unavailable' };

  const target = await resolveWechatTarget(serverDB, userId);
  if (!target) return { status: 'unlinked' };

  const redis = getAgentRuntimeRedisClient() as WechatWindowRedis | null;
  if (!redis) {
    log('sendProactiveWechatMessage: redis unavailable, cannot resolve send window');
    return { status: 'unavailable' };
  }

  const payload: WechatPendingPush = { attachments, content, enqueuedAt: Date.now() };
  const count = pendingPushSendCount(payload);
  const credit = await consumeSendCredits(
    redis,
    target.applicationId,
    target.platformUserId,
    count,
  );

  if (credit.status !== 'ok') {
    await enqueuePendingPush(redis, target.applicationId, target.platformUserId, payload);
    log(
      'sendProactiveWechatMessage: window %s for user %s — queued',
      credit.status,
      target.platformUserId,
    );
    return { status: 'queued' };
  }

  try {
    await deliver(target.api, target.platformUserId, credit.token, payload);
    return { remaining: credit.remaining, status: 'sent' };
  } catch (error) {
    // The consumed credit is intentionally not refunded — a rejected send
    // usually means the token is stale, so undercounting is the safe side.
    log('sendProactiveWechatMessage: send failed, queueing for replay: %O', error);
    await enqueuePendingPush(redis, target.applicationId, target.platformUserId, payload);
    return { status: 'queued' };
  }
};

/**
 * Replay pushes queued while the window was closed. Called after an inbound
 * message refreshes the window (see WechatInstallationStore.resolveByPayload).
 * Stops early when the backlog would eat into the credits reserved for the
 * live reply.
 */
export const flushPendingWechatPushes = async (params: {
  applicationId: string;
  baseUrl?: string;
  botId?: string;
  botToken: string;
  platformUserId: string;
  redis: WechatWindowRedis;
}): Promise<number> => {
  const { redis, applicationId, platformUserId } = params;
  const api = new WechatApiClient(params.botToken, params.botId, params.baseUrl);

  return drainPendingPushes(redis, applicationId, platformUserId, async (payload) => {
    const count = pendingPushSendCount(payload);
    const sendWindow = await peekWindow(redis, applicationId, platformUserId);
    if (!sendWindow || sendWindow.remaining - count < RESERVED_REPLY_CREDITS) return 'stop';

    const credit = await consumeSendCredits(redis, applicationId, platformUserId, count);
    if (credit.status !== 'ok') return 'stop';

    try {
      await deliver(api, platformUserId, credit.token, payload);
      return 'sent';
    } catch (error) {
      log('flushPendingWechatPushes: replay failed for %s: %O', platformUserId, error);
      return 'stop';
    }
  });
};
