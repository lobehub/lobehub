import type { Chat } from 'chat';
import debug from 'debug';

import { getBotFeatureAccessState } from '@/business/server/bot/featureAccess';

import { createOrGetPairingRequest } from '../dmPairingStore';
import {
  type BotReplyLocale,
  type DmDecision,
  type DmSettings,
  type GroupSettings,
  type GuestDecision,
  type GuestSettings,
  type PlatformClient,
  shouldAllowSender,
  shouldHandleDm,
  shouldHandleGroup,
  shouldHandleGuest,
  type UserAllowlist,
} from '../platforms';
import { isGuestTelegramThreadId } from '../platforms/telegram/threadId';
import {
  renderDmPairing,
  renderDmRejected,
  renderGroupRejected,
  renderGuestPairing,
  renderGuestRejected,
  renderSenderRejected,
} from '../replyTemplate';
import type { BotAccessGate } from './types';

const log = debug('lobe-server:bot:message-router');
const WECHAT_PRO_FEATURE_NOTICE =
  '提示：由于 WeChat 渠道通信成本过高，LobeHub 微信渠道能力将于近期调整为付费功能。预告期内已有连接可继续使用，但新建或重新连接微信渠道需要升级到个人付费 Plan。';
const WECHAT_PRO_FEATURE_NOTICE_WORKSPACE =
  '提示：由于 WeChat 渠道通信成本过高，LobeHub 微信渠道能力将于近期调整为付费功能。预告期内已有连接可继续使用，但新建或重新连接微信渠道需要将所属工作区升级到付费 Plan。';

export interface AccessGateParams {
  agentId: string;
  applicationId: string;
  bot: Chat<any>;
  client: PlatformClient;
  dmSettings: DmSettings;
  /** Reads the shared Redis client lazily, at pairing time. */
  getRedisClient: () => any;
  groupSettings: GroupSettings;
  guestSettings: GuestSettings;
  operatorUserId?: string;
  platform: string;
  userAllowlist: UserAllowlist;
  userId: string;
  workspaceId?: string;
}

/**
 * Build the access gate for one registered bot. The policy helpers close over
 * the bot's settings exactly as they did inside `registerHandlers`.
 */
export const createAccessGate = ({
  agentId,
  applicationId,
  bot,
  client,
  dmSettings,
  getRedisClient,
  groupSettings,
  guestSettings,
  operatorUserId,
  platform,
  userAllowlist,
  userId,
  workspaceId,
}: AccessGateParams): BotAccessGate => {
  /**
   * Global user-level gate. Applied **before** any per-scope policy so a
   * populated `allowFrom` restricts every inbound surface (DMs, group
   * @mentions, threads) to listed users. Empty list = no filter.
   */
  const passesGlobalAllowlist = (message: { author?: { userId?: string } }): boolean =>
    shouldAllowSender({
      authorUserId: message.author?.userId,
      userAllowlist,
    });

  /**
   * Gate inbound events on DM policy. Non-DM threads pass through — their
   * group-policy / @mention rules apply instead. The `'pair'` decision
   * is distinct from `'reject'` because the router branches on it (issue
   * a pairing code) — see `passGatesOrNotify` below.
   */
  const passesDmPolicy = (
    thread: { isDM?: boolean },
    message: { author?: { userId?: string } },
  ): DmDecision =>
    shouldHandleDm({
      authorUserId: message.author?.userId,
      dmSettings,
      isDM: thread.isDM === true,
      operatorUserId,
      userAllowlist,
    });

  const passesGuestPolicy = (
    thread: { id: string },
    message: { author?: { userId?: string } },
  ): GuestDecision =>
    shouldHandleGuest({
      authorUserId: message.author?.userId,
      guestSettings,
      isGuest: platform === 'telegram' && isGuestTelegramThreadId(thread.id),
      operatorUserId,
      userAllowlist,
    });

  /**
   * Gate inbound events on group policy. DM threads pass through — they
   * are governed by `passesDmPolicy` instead. Non-DM threads are blocked
   * when disabled, and filtered against `groupAllowFrom` (channel / group
   * / chat IDs) when set to `allowlist`.
   *
   * Operators paste **raw** platform IDs (what Discord's "Copy Channel
   * ID" or Telegram's chat-id tools yield), but `thread.channelId` is a
   * *composite* string carrying the platform prefix
   * (`discord:guild:channel`, `telegram:chatId`, …). Using it directly
   * never matches a raw paste. Each PlatformClient already exposes
   * `extractChatId` returning the most-specific raw ID, so we use that
   * as the primary candidate.
   *
   * Discord-only quirk: a bare `@mention` in a parent channel triggers
   * an auto-reply thread; `extractChatId` then resolves to the thread,
   * not the parent operators pasted. `extraGroupAllowlistChannels`
   * surfaces the parent so either ID lets the message through.
   */
  const passesGroupPolicy = (thread: { id: string; isDM?: boolean }): boolean => {
    // Guest Mode has its own user-scoped policy. It remains separate from
    // Group Policy because the bot has not joined the source chat.
    if (platform === 'telegram' && isGuestTelegramThreadId(thread.id)) return true;
    return shouldHandleGroup({
      candidateChannelIds: [
        client.extractChatId(thread.id),
        ...(client.extraGroupAllowlistChannels?.(thread.id) ?? []),
      ],
      groupSettings,
      isDM: thread.isDM === true,
    });
  };

  /**
   * Handle a sender that the global `allowFrom` rejected. Posts the
   * notice in the same thread the inbound event arrived on, mirroring
   * `notifyGroupRejected` / `notifyDmRejected` rather than escalating
   * to ephemeral / out-of-band DM.
   *
   * - DM scope: uses the DM-allowlist copy ("you aren't authorized to
   *   send direct messages…") since the sender is on the DM surface.
   * - Group scope: uses the generic `senderRejected` copy that avoids
   *   "direct messages" — the sender @-mentioned in a group, not in a
   *   DM. On Discord this lands inside the auto-created reply thread,
   *   so it doesn't pollute the parent channel; on Telegram / Slack /
   *   Feishu it's visible to the group, which is consistent with how
   *   `notifyGroupRejected` already handles policy-driven rejections.
   */
  const handleSenderRejected = async (
    thread: { isDM?: boolean; post: (text: string) => Promise<unknown> },
    replyLocale: BotReplyLocale,
  ): Promise<void> => {
    const text =
      thread.isDM === true
        ? renderDmRejected('allowlist', replyLocale)
        : renderSenderRejected(replyLocale);
    try {
      await thread.post(text);
    } catch (error) {
      log('handleSenderRejected: failed to post rejection notice: %O', error);
    }
  };

  /**
   * Post a one-line system reply telling the sender why their DM was
   * dropped. Best-effort — a transient platform error must never bubble
   * back into the handler since the message is informational, not part of
   * the agent flow.
   */
  const notifyDmRejected = async (
    thread: { post: (text: string) => Promise<unknown> },
    replyLocale: BotReplyLocale,
  ): Promise<void> => {
    // 'open' and 'pairing' should never reach here ('pairing' has its own
    // flow via triggerPairing), but guard anyway so we never post the
    // wrong copy if shouldHandleDm grows another false branch.
    if (dmSettings.policy !== 'allowlist' && dmSettings.policy !== 'disabled') return;
    try {
      await thread.post(renderDmRejected(dmSettings.policy, replyLocale));
    } catch (error) {
      log('notifyDmRejected: failed to post rejection notice: %O', error);
    }
  };

  /**
   * Same shape as `notifyDmRejected`, for group / channel rejection. The
   * @mention is public, so the rejection is too — operators get UX
   * feedback that their bot is configured to a smaller scope.
   */
  const notifyGroupRejected = async (
    thread: { post: (text: string) => Promise<unknown> },
    replyLocale: BotReplyLocale,
  ): Promise<void> => {
    if (groupSettings.policy === 'open') return;
    try {
      await thread.post(renderGroupRejected(groupSettings.policy, replyLocale));
    } catch (error) {
      log('notifyGroupRejected: failed to post rejection notice: %O', error);
    }
  };

  const notifyGuestRejected = async (
    thread: { post: (text: string) => Promise<unknown> },
    replyLocale: BotReplyLocale,
  ): Promise<void> => {
    if (guestSettings.policy !== 'allowlist' && guestSettings.policy !== 'disabled') return;
    try {
      await thread.post(renderGuestRejected(guestSettings.policy, replyLocale));
    } catch (error) {
      log('notifyGuestRejected: failed to post rejection notice: %O', error);
    }
  };

  /**
   * Pairing branch shared by DM and Telegram Guest policies. Issue (or
   * recycle, when the same applicant retries within the TTL) a one-time
   * code, persist a pending entry to Redis so `/approve <code>` can later
   * append the applicant to `allowFrom`, and post the code on the original
   * request surface.
   *
   * Best-effort: if Redis is unwired (`'redis-unavailable'`) or the
   * per-bot pending cap is hit (`'capacity-exceeded'`), surface a useful
   * status string to the applicant rather than silently dropping them —
   * silent drops look broken and operators waste time debugging.
   */
  const triggerPairing = async (
    thread: { id: string; post: (text: string) => Promise<unknown> },
    author: { userId?: string; userName?: string },
    replyLocale: BotReplyLocale,
    scope: 'dm' | 'guest',
  ): Promise<void> => {
    if (!author.userId) {
      log(
        'triggerPairing: missing author userId, cannot pair (agent=%s, platform=%s, scope=%s)',
        agentId,
        platform,
        scope,
      );
      return;
    }
    const result = await createOrGetPairingRequest({
      applicant: {
        applicantUserId: author.userId,
        applicantUserName: author.userName,
        replyLocale,
        threadId: thread.id,
      },
      applicationId,
      platform,
      redis: getRedisClient(),
    });
    let text: string;
    if (result.status === 'created' || result.status === 'reused') {
      text =
        scope === 'guest'
          ? renderGuestPairing('code', replyLocale, { code: result.code })
          : renderDmPairing('code', replyLocale, { code: result.code });
    } else if (result.status === 'capacity-exceeded') {
      text =
        scope === 'guest'
          ? renderGuestPairing('capacity-exceeded', replyLocale)
          : renderDmPairing('capacity-exceeded', replyLocale);
    } else {
      text =
        scope === 'guest'
          ? renderGuestPairing('unavailable', replyLocale)
          : renderDmPairing('unavailable', replyLocale);
    }
    try {
      await thread.post(text);
    } catch (error) {
      log('triggerPairing: failed to post pairing notice: %O', error);
    }
  };

  const notifyFeatureNoticeOnce = async (
    thread: { post: (t: string) => Promise<unknown> },
    author: { userId?: string },
    noticeId: string,
    caller: string,
  ): Promise<void> => {
    if (platform !== 'wechat') return;

    const authorUserId = author.userId?.trim();
    if (!authorUserId) return;

    const key = `bot-feature-notice:${noticeId}:${authorUserId}`;
    try {
      const fresh = await bot.getState().setIfNotExists(key, '1');
      if (!fresh) return;
    } catch (error) {
      log('%s: feature notice dedupe failed, continuing without notice: %O', caller, error);
      return;
    }

    try {
      // Workspace-owned channels upgrade at the workspace, not the owner's
      // personal plan — keep the notice copy consistent with the channel UI.
      await thread.post(
        workspaceId ? WECHAT_PRO_FEATURE_NOTICE_WORKSPACE : WECHAT_PRO_FEATURE_NOTICE,
      );
    } catch (error) {
      log('%s: failed to post feature notice: %O', caller, error);
    }
  };

  /**
   * Run all three access gates (global `allowFrom`, group policy, DM policy)
   * and post the appropriate rejection notice in the thread on failure.
   * Returns true when the inbound passes every gate.
   *
   * Centralised so every entry point — @-mentions, subscribed-message
   * handler, DM catch-all, **and the slash-command dispatchers** — applies
   * the same checks. Without this, a /command path could side-effect
   * (`/stop` cancelling a run, `/new` resetting state) for senders the
   * normal message path would have rejected.
   */
  const passGatesOrNotify = async (
    thread: { id: string; isDM?: boolean; post: (t: string) => Promise<unknown> },
    author: { userId?: string; userName?: string },
    replyLocale: BotReplyLocale,
    caller: string,
  ): Promise<boolean> => {
    /**
     * Group-scope rejection notices land in the platform's reply thread
     * (on Discord, the auto-created thread under the @mention). The
     * rejected sender is never added to that thread — only the success
     * path (`AgentBridgeService.executeWithCallback`) calls
     * `ensureThreadMember` — so they get no notification and perceive
     * the rejection as the bot silently ignoring them. Pull them into
     * the thread before posting so the notice is actually seen.
     * DM threads deliver in place; platforms without the hook no-op.
     */
    const ensureRejectionVisible = async (): Promise<void> => {
      if (thread.isDM === true || !author.userId || !client.ensureThreadMember) return;
      try {
        await client.ensureThreadMember(thread.id, author.userId);
      } catch (error) {
        log('%s: ensureThreadMember for rejection notice failed: %O', caller, error);
      }
    };

    const featureAccess = await getBotFeatureAccessState({
      action: 'runtime',
      applicationId,
      platform,
      userId,
      workspaceId: workspaceId ?? undefined,
    });

    // Plan state must not leak to senders/groups the bot is configured to
    // ignore: both the enforce-mode denial and the rollout notice are only
    // posted after every gate below passes — rejected callers get the
    // regular rejection copy (or silence) instead.
    const finishFeatureAccess = async (): Promise<boolean> => {
      if (!featureAccess.allowed) {
        try {
          await ensureRejectionVisible();
          await thread.post(featureAccess.blockedMessage ?? 'This bot channel is unavailable.');
        } catch (error) {
          log('%s: failed to post paid-feature notice: %O', caller, error);
        }
        return false;
      }
      if (featureAccess.notice) {
        await notifyFeatureNoticeOnce(thread, author, featureAccess.notice.id, caller);
      }
      return true;
    };

    // Owner override. The bot's operator (`settings.userId`) sets the
    // policies for *other* users — locking themselves out of their own
    // bot is a footgun. Without this branch:
    // - `/approve` in any group channel that isn't in `groupAllowFrom`
    //   gets rejected by the group gate, breaking the approval flow
    //   from a not-yet-allowed channel (Discord native slash commands
    //   in particular sometimes report `event.channel.isDM=false` for
    //   DM invocations, putting the gate on the group branch).
    // - DMing a `disabled` bot for a self-test gets blocked.
    // The override is unconditional on author identity, so non-command
    // messages from the operator also pass — that matches the existing
    // implicit-merge of `settings.userId` into `extractUserAllowlist`,
    // which already treats the operator as always-allowed.
    if (operatorUserId && author.userId === operatorUserId) {
      return finishFeatureAccess();
    }
    // Pairing redefines what `allowFrom` means: it's the post-approval
    // list. Pairing applicants must reach their scope gate so it can issue
    // a code instead of being short-circuited by the global allowlist.
    const isGuest = platform === 'telegram' && isGuestTelegramThreadId(thread.id);
    const isPairingDm = thread.isDM === true && dmSettings.policy === 'pairing';
    const isPairingGuest = isGuest && guestSettings.policy === 'pairing';
    if (!isPairingDm && !isPairingGuest && !passesGlobalAllowlist({ author })) {
      log(
        '%s: sender blocked by allowFrom, agent=%s, platform=%s, thread=%s, author=%s',
        caller,
        agentId,
        platform,
        thread.id,
        author.userName ?? author.userId,
      );
      await ensureRejectionVisible();
      await handleSenderRejected(thread, replyLocale);
      return false;
    }
    const guestDecision = passesGuestPolicy(thread, { author });
    if (guestDecision !== 'allow') {
      log(
        '%s: Guest gate=%s, agent=%s, platform=%s, thread=%s, author=%s, policy=%s',
        caller,
        guestDecision,
        agentId,
        platform,
        thread.id,
        author.userName ?? author.userId,
        guestSettings.policy,
      );
      await ensureRejectionVisible();
      if (guestDecision === 'pair') {
        await triggerPairing(thread, author, replyLocale, 'guest');
      } else {
        await notifyGuestRejected(thread, replyLocale);
      }
      return false;
    }
    if (!passesGroupPolicy(thread)) {
      log(
        '%s: group blocked by policy, agent=%s, platform=%s, thread=%s, policy=%s',
        caller,
        agentId,
        platform,
        thread.id,
        groupSettings.policy,
      );
      await ensureRejectionVisible();
      await notifyGroupRejected(thread, replyLocale);
      return false;
    }
    const dmDecision = passesDmPolicy(thread, { author });
    if (dmDecision === 'allow') {
      return finishFeatureAccess();
    }
    log(
      '%s: DM gate=%s, agent=%s, platform=%s, thread=%s, author=%s, policy=%s',
      caller,
      dmDecision,
      agentId,
      platform,
      thread.id,
      author.userName ?? author.userId,
      dmSettings.policy,
    );
    if (dmDecision === 'pair') {
      await triggerPairing(thread, author, replyLocale, 'dm');
    } else {
      await notifyDmRejected(thread, replyLocale);
    }
    return false;
  };

  return passGatesOrNotify;
};
