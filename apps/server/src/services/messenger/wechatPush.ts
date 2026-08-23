import { getWechatTextSendCount, WechatApiClient } from '@lobechat/chat-adapter-wechat';
import debug from 'debug';

import { MessengerAccountLinkModel } from '@/database/models/messengerAccountLink';
import type { LobeChatDatabase } from '@/database/type';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  buildAttachmentFallbackLine,
  PLATFORM_ATTACHMENT_BUDGETS,
  prepareAttachmentsForBudget,
  splitFallbackMessages,
} from '@/server/services/bot/platforms/attachmentBudget';
import {
  consumeSendCredits,
  drainPendingPushes,
  type DrainPendingResult,
  enqueuePendingPush,
  peekWindow,
  WECHAT_WINDOW_MAX_SENDS,
  type WechatPendingPush,
  wechatPendingPushKey,
  wechatWindowKey,
  type WechatWindowRedis,
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

/**
 * Why a push ended up `queued`. The client picks its toast off this — telling
 * a user whose window is visibly open that "the send window is closed" reads
 * as a bug (and was reported as one), so the three queue paths are kept
 * distinguishable.
 */
export type WechatPushQueueReason =
  /** No open send window — the classic "message the bot to receive it" case. */
  | 'window_closed'
  /** Window open but not enough sends left for this delivery. */
  | 'quota_exhausted'
  /** Delivery was attempted and partially failed; the rest is queued for retry. */
  | 'send_failed'
  /** An earlier message is still being delivered; this one waits behind it. */
  | 'delivery_in_progress';

export interface WechatPushResult {
  /** Set when `status` is `queued` — why delivery had to wait. */
  reason?: WechatPushQueueReason;
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

  // An attachment can pass the byte budget yet still be unsendable through
  // iLink (observed: an ~11MB MP4 where every upload attempt fails). Blindly
  // requeueing such an attachment retries it on every inbound message and it
  // NEVER reaches the user — not even as a link — until the 72h queue TTL
  // silently drops it. So degrade upload failures with a `fetchUrl` to a
  // download-link message right now, exactly what the budget pass would have
  // produced had it known the platform would refuse the file. The extra link
  // sends are not pre-reserved against the window quota; the quota is
  // best-effort bookkeeping (WeChat enforces the real limit) and undercounting
  // here beats losing the attachment.
  if (failedOriginals.length > 0) {
    const linkable = failedOriginals.filter((attachment) => attachment.fetchUrl);
    const unlinkable = failedOriginals.filter((attachment) => !attachment.fetchUrl);

    if (linkable.length > 0) {
      const rescueMessages = splitFallbackMessages(
        linkable.map((attachment) => buildAttachmentFallbackLine(attachment, attachment.fetchUrl!)),
        PLATFORM_ATTACHMENT_BUDGETS.wechat.textMaxChars,
      );
      try {
        for (const message of rescueMessages) {
          await api.sendMessage(platformUserId, message, token);
        }
        progress.undeliveredAttachments = unlinkable;
      } catch (error) {
        // The rescue leg itself failed — keep the linkable originals owed so
        // the replay path can try the degrade again (bounded by the queue TTL).
        log('deliver: link fallback for failed uploads also failed: %O', error);
      }
    }

    // Only attachments with no smaller representation left (no fetchUrl, or a
    // failed rescue leg) are retried on the next inbound message — the queue's
    // 72h TTL and size cap bound the retries.
    if (progress.undeliveredAttachments.length > 0)
      throw new Error(
        `${progress.undeliveredAttachments.length} WeChat attachment(s) failed to send`,
      );
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

  // Skip the budget pass entirely when the window is already closed: the queue
  // stores the untouched payload and the replay prepares it again.
  const window = await peekWindow(redis, target.applicationId, target.platformUserId);
  if (!window || window.remaining <= 0) {
    await enqueuePendingPush(redis, target.applicationId, target.platformUserId, payload);
    log('sendProactiveWechatMessage: window closed for user %s — queued', target.platformUserId);
    return { reason: 'window_closed', status: 'queued' };
  }

  // The window is open: drain any backlog queued while it was closed BEFORE
  // sending the new message. Without this the settings UI can show an open
  // window sitting next to "N messages queued" (the queue only replays on the
  // next INBOUND message), and a fresh push would overtake the backlog,
  // breaking FIFO delivery.
  const drain = await drainQueuedPushes({
    api: target.api,
    applicationId: target.applicationId,
    platformUserId: target.platformUserId,
    redis,
  });

  // Only send now if THIS call drained the queue and left it empty.
  //
  // The drain does not always empty the queue: it stops once the backlog would
  // eat into the credits reserved for the live reply, and it requeues any leg
  // that failed mid-delivery. And when it could not take the lock at all, a
  // concurrent drain is mid-flight with its current item already LPOP'd — the
  // list would read as empty from here while an older message is still being
  // delivered. Sending in either case lets a fresh (often smaller) push jump
  // ahead of older ones, exactly the FIFO break this block exists to prevent.
  if (!drain.drained || drain.remaining > 0) {
    await enqueuePendingPush(redis, target.applicationId, target.platformUserId, payload);
    log(
      'sendProactiveWechatMessage: queued behind backlog for %s (drained=%s, remaining=%d)',
      target.platformUserId,
      drain.drained,
      drain.remaining,
    );
    if (!drain.drained) return { reason: 'delivery_in_progress', status: 'queued' };

    // Distinguish "the drain ran out of credits" from "a replay failed", so the
    // toast matches what the user sees in the window state.
    const afterDrain = await peekWindow(redis, target.applicationId, target.platformUserId);
    if (!afterDrain) return { reason: 'window_closed', status: 'queued' };
    return {
      reason: afterDrain.remaining <= RESERVED_REPLY_CREDITS ? 'quota_exhausted' : 'send_failed',
      status: 'queued',
    };
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
    // `missing` means the window vanished between the peek and the consume
    // (TTL expiry) — from the user's perspective the window closed.
    return {
      reason: credit.status === 'exhausted' ? 'quota_exhausted' : 'window_closed',
      status: 'queued',
    };
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
    return { reason: 'send_failed', status: 'queued' };
  }
};

/**
 * Replay pushes queued while the window was closed, against an existing API
 * client. Shared by the inbound-message flush (`flushPendingWechatPushes`)
 * and the proactive-push path, which drains the backlog before sending a new
 * message whenever it finds the window already open. Stops early when the
 * backlog would eat into the credits reserved for the live reply.
 */
const drainQueuedPushes = async (params: {
  api: WechatApiClient;
  applicationId: string;
  platformUserId: string;
  redis: WechatWindowRedis;
}): Promise<DrainPendingResult> => {
  const { api, redis, applicationId, platformUserId } = params;

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
      log('drainQueuedPushes: replay failed for %s: %O', platformUserId, error);
      // Requeue only the legs still owed — `undefined` means everything landed.
      const remaining = undeliveredPayload(payload, progress);
      return remaining ? { requeue: remaining } : 'sent';
    }
  });
};

/**
 * Replay pushes queued while the window was closed. Called after an inbound
 * message refreshes the window (see WechatInstallationStore.resolveByPayload).
 */
export const flushPendingWechatPushes = async (params: {
  applicationId: string;
  baseUrl?: string;
  botId?: string;
  botToken: string;
  platformUserId: string;
  redis: WechatWindowRedis;
}): Promise<number> =>
  drainQueuedPushes({
    api: new WechatApiClient(params.botToken, params.botId, params.baseUrl),
    applicationId: params.applicationId,
    platformUserId: params.platformUserId,
    redis: params.redis,
  }).then((result) => result.sent);
