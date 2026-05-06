import debug from 'debug';

import { appEnv } from '@/envs/app';
import type { PlatformClient } from '@/server/services/bot/platforms';
import { SlackApi } from '@/server/services/bot/platforms/slack/api';
import { SlackClientFactory } from '@/server/services/bot/platforms/slack/client';

import { getInstallationStore } from '../../installations';
import type { InstallationCredentials } from '../../installations/types';
import { issueLinkToken } from '../../linkTokenStore';
import type {
  AgentPickerEntry,
  CallbackAcknowledgement,
  InboundCallbackAction,
  MessengerPlatformBinder,
  UnlinkedMessageContext,
} from '../../types';

const log = debug('lobe-server:messenger:slack');

/**
 * Application prefix on Slack `action_id`s so we can distinguish OUR buttons
 * from anything else the workspace might inject. Format:
 * `messenger:<verb>:<arg>` — mirrors the Telegram binder's `callback_data`
 * convention so the router can reuse the same matcher.
 */
const ACTION_PREFIX = 'messenger:';

/** Build the verify-im URL with all Slack context Manus passes (so the
 *  consent page can render the email + workspace and the user has nothing
 *  more to type). */
const buildVerifyImUrl = (params: {
  appUrl: string;
  channel: string;
  randomId: string;
  slackTeamId: string;
  slackUserEmail: string;
  slackUserId: string;
  thread?: string;
}): string => {
  const url = new URL('/verify-im', params.appUrl);
  url.searchParams.set('im_type', 'slack');
  url.searchParams.set('random_id', params.randomId);
  url.searchParams.set('slack_user_id', params.slackUserId);
  url.searchParams.set('slack_team_id', params.slackTeamId);
  if (params.slackUserEmail) {
    url.searchParams.set('slack_user_email', params.slackUserEmail);
  }
  url.searchParams.set('channel', params.channel);
  url.searchParams.set('thread', params.thread ?? '');
  url.searchParams.set('utm_source', 'messenger_slack');
  return url.toString();
};

const buildSwitchButtons = (
  entries: AgentPickerEntry[],
): Array<{ actionId: string; style?: 'primary'; text: string; value: string }> =>
  entries.map((entry) => ({
    actionId: `${ACTION_PREFIX}switch:${entry.id}`,
    text: entry.isActive ? `✅ ${entry.title}` : entry.title,
    value: entry.id,
    ...(entry.isActive ? { style: 'primary' as const } : {}),
  }));

/**
 * Per-Slack-workspace binder. Constructed by `MessengerRouter` from
 * `InstallationCredentials` resolved out of the inbound webhook (or by
 * `notifyLinkSuccess` from `installationStore.resolveByKey('slack:'+tenantId)`).
 *
 * All outbound calls use `this.creds.botToken` — env is no longer read.
 * Constructed without creds, the binder no-ops every method (the legacy
 * env-only call sites still exist during PR2 rollout).
 */
export class MessengerSlackBinder implements MessengerPlatformBinder {
  protected readonly creds?: InstallationCredentials;

  constructor(creds?: InstallationCredentials) {
    this.creds = creds;
  }

  async createClient(): Promise<PlatformClient | null> {
    if (!this.creds) {
      log('createClient: no InstallationCredentials supplied');
      return null;
    }
    return new SlackClientFactory().createClient(
      {
        // Per-install applicationId so chat-sdk's bookkeeping / dedupe / queue
        // keys never collide across workspaces.
        applicationId: this.creds.installationKey,
        credentials: {
          botToken: this.creds.botToken,
          signingSecret: this.creds.signingSecret ?? '',
        },
        platform: 'slack',
        settings: {},
      },
      { appUrl: appEnv.APP_URL },
    );
  }

  /**
   * First-touch: post the link prompt as a normal in-history DM with a
   * Block Kit button AND the same URL as a plain inline link below it.
   * Email-style fallback — the button is the primary CTA, the link is the
   * fallback for mobile / copy-paste / weird Block Kit renders.
   */
  async handleUnlinkedMessage(ctx: UnlinkedMessageContext): Promise<void> {
    if (!this.creds) {
      log('handleUnlinkedMessage: no creds, skipping');
      return;
    }
    const appUrl = appEnv.APP_URL;
    if (!appUrl) {
      log('handleUnlinkedMessage: APP_URL not set, cannot build verify-im link');
      return;
    }

    const tenantName = String(this.creds.metadata?.tenantName ?? '');

    let randomId: string;
    try {
      randomId = await issueLinkToken({
        platform: 'slack',
        platformUserId: ctx.authorUserId,
        platformUsername: ctx.authorUserName,
        tenantId: this.creds.tenantId,
        tenantName,
      });
    } catch (error) {
      log('handleUnlinkedMessage: failed to issue link token: %O', error);
      const api = new SlackApi(this.creds.botToken);
      await api.postMessage(
        ctx.chatId,
        'LobeHub is temporarily unavailable. Please try again in a moment.',
      );
      return;
    }

    // Best-effort prefill of the user's email for the verify-im page. Falls
    // back to '' if `users:read.email` scope wasn't granted or the API call
    // fails — verify-im handles a missing email gracefully.
    let email = '';
    try {
      const api = new SlackApi(this.creds.botToken);
      const user = await api.getUserInfo(ctx.authorUserId);
      email = user?.profile?.email ?? '';
    } catch (error) {
      log('handleUnlinkedMessage: getUserInfo failed: %O', error);
    }

    const verifyUrl = buildVerifyImUrl({
      appUrl,
      channel: ctx.chatId,
      randomId,
      slackTeamId: this.creds.tenantId,
      slackUserEmail: email,
      slackUserId: ctx.authorUserId,
      thread: '',
    });

    const intro =
      "Hi, I'm LobeHub — your AI agent in Slack.\n" + 'To start, link your LobeHub account.';
    const linkLabel = `Or copy this link: <${verifyUrl}|${verifyUrl}>`;

    const api = new SlackApi(this.creds.botToken);
    try {
      await api.postMessageWithButtonAndLink(
        ctx.chatId,
        intro,
        { text: ':link: Link Account', url: verifyUrl },
        linkLabel,
      );
    } catch (error) {
      log('handleUnlinkedMessage: postMessageWithButtonAndLink failed: %O', error);
    }
  }

  /**
   * Confirmation back into the Slack DM after the user finishes verify-im.
   *
   * Lazily resolves install credentials by `tenantId` because this call
   * originates from the TRPC lambda router (which constructs binders without
   * creds). For per-tenant platforms the caller MUST supply `tenantId` so we
   * can pick the right workspace's bot token.
   */
  async notifyLinkSuccess(params: {
    activeAgentName?: string;
    platformUserId: string;
    tenantId?: string;
  }): Promise<void> {
    let creds = this.creds;
    if (!creds) {
      if (!params.tenantId) {
        log('notifyLinkSuccess: missing tenantId for slack — cannot resolve install');
        return;
      }
      const store = getInstallationStore('slack');
      if (!store) return;
      const resolved = await store.resolveByKey(`slack:${params.tenantId}`);
      if (!resolved) {
        log('notifyLinkSuccess: install not found for tenantId=%s', params.tenantId);
        return;
      }
      creds = resolved;
    }

    const headline =
      ':white_check_mark: Linked successfully! Your LobeHub account is now connected.';
    const tail = params.activeAgentName
      ? `\n\nActive agent: *${params.activeAgentName}*\n\nGo ahead and send your first message — send \`/agents\` any time to switch the active agent.`
      : '\n\nSend `/agents` to list your agents and pick the active one.';

    try {
      // Slack accepts a user id as the `channel` arg and auto-opens the IM
      // (requires `im:write` scope on the App).
      const api = new SlackApi(creds.botToken);
      await api.postMessage(params.platformUserId, `${headline}${tail}`);
    } catch (error) {
      log('notifyLinkSuccess: failed to send to %s: %O', params.platformUserId, error);
    }
  }

  async sendDmText(chatId: string, text: string): Promise<void> {
    if (!this.creds) {
      log('sendDmText: no creds, skipping');
      return;
    }
    try {
      await new SlackApi(this.creds.botToken).postMessage(chatId, text);
    } catch (error) {
      log('sendDmText: failed to send to chat=%s: %O', chatId, error);
    }
  }

  async sendAgentPicker(
    chatId: string,
    params: { entries: AgentPickerEntry[]; text: string },
  ): Promise<void> {
    if (!this.creds) {
      log('sendAgentPicker: no creds, skipping');
      return;
    }
    try {
      const api = new SlackApi(this.creds.botToken);
      await api.postMessageWithButtonGrid(chatId, params.text, buildSwitchButtons(params.entries));
    } catch (error) {
      log('sendAgentPicker: failed for chat=%s: %O', chatId, error);
    }
  }

  /**
   * Pull our `messenger:switch:<agentId>` action out of a Slack interactive
   * webhook payload. Slack delivers `block_actions` as
   * `application/x-www-form-urlencoded` with a single `payload` field whose
   * value is JSON, so we parse here rather than rely on the router's JSON
   * path. Returns null for any other update so the caller can hand off to
   * chat-sdk.
   */
  async extractCallbackAction(req: Request): Promise<InboundCallbackAction | null> {
    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.includes('application/x-www-form-urlencoded')) return null;

    let payload: any;
    try {
      const raw = await req.text();
      const params = new URLSearchParams(raw);
      const payloadStr = params.get('payload');
      if (!payloadStr) return null;
      payload = JSON.parse(payloadStr);
    } catch {
      return null;
    }

    if (!payload || payload.type !== 'block_actions') return null;
    const action = payload.actions?.[0];
    const actionId = action?.action_id ? String(action.action_id) : '';
    if (!actionId.startsWith(ACTION_PREFIX)) return null;

    const fromUserId = payload.user?.id ? String(payload.user.id) : '';
    // For DMs the channel id is in `payload.channel.id`; for app-home or some
    // surfaces it can be missing — we only support DM-channel pickers today.
    const chatId = payload.channel?.id ? String(payload.channel.id) : '';
    const messageTs = payload.message?.ts ? String(payload.message.ts) : undefined;
    if (!fromUserId || !chatId) return null;

    return {
      // `response_url` is what we'd use to ack via response payload — Slack
      // accepts up to 5 calls within 30 minutes per response_url. We use
      // chat.update + chat.postEphemeral via `acknowledgeCallback` instead.
      callbackId: payload.response_url ? String(payload.response_url) : '',
      chatId,
      data: actionId,
      fromUserId,
      messageId: messageTs,
    };
  }

  async acknowledgeCallback(
    action: InboundCallbackAction,
    ack: CallbackAcknowledgement,
  ): Promise<void> {
    if (!this.creds) {
      log('acknowledgeCallback: no creds, skipping');
      return;
    }
    const api = new SlackApi(this.creds.botToken);

    // Re-render the picker first so the new active marker shows up before any
    // ephemeral feedback fires (and even if the ephemeral post fails).
    if (ack.updatedPicker && action.messageId !== undefined) {
      try {
        await api.updateMessageWithButtonGrid(
          action.chatId,
          String(action.messageId),
          ack.updatedPicker.text,
          buildSwitchButtons(ack.updatedPicker.entries),
        );
      } catch (error) {
        log('acknowledgeCallback: update picker failed: %O', error);
      }
    }

    if (ack.toast) {
      try {
        // Slack has no native toast for button taps (unlike Telegram's
        // `answerCallbackQuery`) — the closest UX is an ephemeral message
        // visible only to the tapper.
        await api.postEphemeral(action.chatId, action.fromUserId, ack.toast);
      } catch (error) {
        log('acknowledgeCallback: postEphemeral failed: %O', error);
      }
    }
  }

  /**
   * Slash commands and other Slack interactions can fire from any channel —
   * reply ephemerally so the response is private to the invoker regardless
   * of where the trigger originated. `/start` in particular MUST be wired
   * (Slack's input bar treats `/start` as a slash command and never
   * delivers it to the regular DM message path; without a registered
   * handler chat-sdk fails to ack within 3s and Slack surfaces
   * `operation_timeout` to the user).
   */
  async replyPrivately(channel: any, user: any, text: string): Promise<void> {
    try {
      await channel.postEphemeral(user, text, { fallbackToDM: true });
    } catch (error) {
      log('replyPrivately: postEphemeral failed: %O', error);
    }
  }
}
