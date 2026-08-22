import { getWechatTextSendCount, WechatApiClient } from '@lobechat/chat-adapter-wechat';
import debug from 'debug';

import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import type { LobeChatDatabase } from '@/database/type';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  PLATFORM_ATTACHMENT_BUDGETS,
  prepareAttachmentsForBudget,
  splitFallbackMessages,
} from '@/server/services/bot/platforms/attachmentBudget';
import type {
  WechatPendingPush,
  WechatWindowRedis,
} from '@/server/services/bot/platforms/wechat/contextWindow';
import {
  consumeSendCredits,
  drainPendingPushes,
  enqueuePendingPush,
  peekWindow,
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

/**
 * A push resolved into the exact iLink calls it will take.
 *
 * The budget pass runs *before* window quota is reserved, not at send time:
 * degradation collapses N over-budget attachments into one download-link
 * message, so counting the raw attachments would reserve credits for sends
 * that never happen — with a 10-credit window and 2 reserved for replies, a
 * 9-attachment push would fail its own quota check on every replay and expire
 * undelivered. It also keeps the Redis-queued payload carrying small URLs
 * instead of megabytes of recompressed base64, since only the original payload
 * is ever enqueued.
 */
interface PreparedWechatDelivery {
  /** In-budget attachments, uploaded as media. */
  attachments: WechatOutboundAttachment[];
  content?: string;
  /** Originals behind `linkMessages`, requeued when the link leg fails. */
  degraded: WechatOutboundAttachment[];
  /** Untouched originals of `attachments`, index-aligned — see PreparedAttachments. */
  keptOriginals: WechatOutboundAttachment[];
  /** Download-link follow-ups, batched to the platform's text limit. */
  linkMessages: string[];
}

const prepareWechatDelivery = async (
  payload: Pick<WechatPendingPush, 'attachments' | 'content'>,
): Promise<PreparedWechatDelivery> => {
  const budget = PLATFORM_ATTACHMENT_BUDGETS.wechat;
  const prepared = payload.attachments?.length
    ? await prepareAttachmentsForBudget(payload.attachments, budget)
    : { attachments: [], degraded: [], fallbackLines: [], keptOriginals: [] };

  return {
    attachments: prepared.attachments,
    content: payload.content?.trim() ? payload.content : undefined,
    degraded: prepared.degraded,
    keptOriginals: prepared.keptOriginals,
    linkMessages: splitFallbackMessages(prepared.fallbackLines, budget.textMaxChars),
  };
};

/** Window credits this delivery will actually consume. */
const wechatDeliverySendCount = (prepared: PreparedWechatDelivery): number =>
  Math.max(
    1,
    (prepared.content ? getWechatTextSendCount(prepared.content) : 0) +
      prepared.attachments.length +
      prepared.linkMessages.length,
  );

/**
 * Which legs of a push have already landed. A push is delivered in up to three
 * calls (text, attachment uploads, download-link follow-ups) and any of them
 * can fail after an earlier one succeeded — without this, requeueing the whole
 * payload would re-send content the user already has on every replay.
 */
interface DeliveryProgress {
  contentDelivered: boolean;
  /**
   * Attachments still owed. Starts as the whole input and narrows to just the
   * degraded ones once the upload leg is done, so a failing link message never
   * requeues an attachment that already arrived.
   */
  undeliveredAttachments?: WechatOutboundAttachment[];
}

/** The part of a payload still owed to the user after a failed `deliver`. */
const undeliveredPayload = (
  payload: WechatPendingPush,
  progress: DeliveryProgress,
): WechatPendingPush | undefined => {
  const remaining = {
    ...payload,
    attachments: progress.undeliveredAttachments ?? payload.attachments,
    content: progress.contentDelivered ? undefined : payload.content,
  };
  if (!remaining.content?.trim() && !remaining.attachments?.length) return undefined;
  return remaining;
};

const deliver = async (
  api: WechatApiClient,
  platformUserId: string,
  token: string,
  prepared: PreparedWechatDelivery,
  progress: DeliveryProgress,
): Promise<void> => {
  if (prepared.content) {
    await api.sendMessage(platformUserId, prepared.content, token);
    progress.contentDelivered = true;
  }
  // Per-item upload failures are swallowed inside `sendWechatAttachments` by
  // design, but it reports which attachments never landed. Map them back to
  // the untouched originals so a failed recompressed image is requeued as its
  // small source rather than megabytes of base64.
  const failed = prepared.attachments.length
    ? await sendWechatAttachments(api, platformUserId, prepared.attachments, token)
    : [];
  const failedOriginals = failed.map(
    (attachment) => prepared.keptOriginals[prepared.attachments.indexOf(attachment)] ?? attachment,
  );
  // Degraded attachments are owed their link until the loop below sends it.
  progress.undeliveredAttachments = [...failedOriginals, ...prepared.degraded];

  for (const message of prepared.linkMessages) {
    await api.sendMessage(platformUserId, message, token);
  }
  progress.undeliveredAttachments = failedOriginals;

  // A reported upload failure is retried on the next inbound message rather
  // than dropped — the same rule the link leg follows, so an attachment is
  // never silently lost just because a *different* leg happened to succeed.
  // Bounded by the queue's own 72h TTL and size cap, so a permanently
  // unsendable attachment cannot retry forever.
  if (failedOriginals.length > 0)
    throw new Error(`${failedOriginals.length} WeChat attachment(s) failed to send`);
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

  // Skip the budget pass entirely when the window is already closed: the queue
  // stores the untouched payload and the replay prepares it again.
  const window = await peekWindow(redis, target.applicationId, target.platformUserId);
  if (!window || window.remaining <= 0) {
    await enqueuePendingPush(redis, target.applicationId, target.platformUserId, payload);
    log('sendProactiveWechatMessage: window closed for user %s — queued', target.platformUserId);
    return { status: 'queued' };
  }

  const prepared = await prepareWechatDelivery(payload);
  const credit = await consumeSendCredits(
    redis,
    target.applicationId,
    target.platformUserId,
    wechatDeliverySendCount(prepared),
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

  const progress: DeliveryProgress = { contentDelivered: false };
  try {
    await deliver(target.api, target.platformUserId, credit.token, prepared, progress);
    return { remaining: credit.remaining, status: 'sent' };
  } catch (error) {
    // The consumed credit is intentionally not refunded — a rejected send
    // usually means the token is stale, so undercounting is the safe side.
    log('sendProactiveWechatMessage: send failed, queueing for replay: %O', error);
    const remaining = undeliveredPayload(payload, progress);
    if (!remaining) return { remaining: credit.remaining, status: 'sent' };
    await enqueuePendingPush(redis, target.applicationId, target.platformUserId, remaining);
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
    const sendWindow = await peekWindow(redis, applicationId, platformUserId);
    if (!sendWindow || sendWindow.remaining <= RESERVED_REPLY_CREDITS) return 'stop';

    // Prepare before the quota check: degradation collapses over-budget
    // attachments into a single link message, and counting the raw payload
    // would reserve credits for sends that never happen — enough to make a
    // large backlog item fail its own check forever.
    const prepared = await prepareWechatDelivery(payload);
    const count = wechatDeliverySendCount(prepared);
    if (sendWindow.remaining - count < RESERVED_REPLY_CREDITS) return 'stop';

    const credit = await consumeSendCredits(redis, applicationId, platformUserId, count);
    if (credit.status !== 'ok') return 'stop';

    const progress: DeliveryProgress = { contentDelivered: false };
    try {
      await deliver(api, platformUserId, credit.token, prepared, progress);
      return 'sent';
    } catch (error) {
      log('flushPendingWechatPushes: replay failed for %s: %O', platformUserId, error);
      // Requeue only the legs still owed — `undefined` means everything landed.
      const remaining = undeliveredPayload(payload, progress);
      return remaining ? { requeue: remaining } : 'sent';
    }
  });
};
