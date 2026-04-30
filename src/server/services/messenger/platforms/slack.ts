import debug from 'debug';

import { getMessengerSlackConfig } from '@/config/messenger';
import { appEnv } from '@/envs/app';
import type { PlatformClient } from '@/server/services/bot/platforms';
import { SlackApi } from '@/server/services/bot/platforms/slack/api';
import { SlackClientFactory } from '@/server/services/bot/platforms/slack/client';

import { issueLinkToken } from '../linkTokenStore';
import type {
  AgentPickerEntry,
  CallbackAcknowledgement,
  InboundCallbackAction,
  MessengerPlatformBinder,
  UnlinkedMessageContext,
} from '../types';

const log = debug('lobe-server:messenger:slack');

/**
 * Application prefix on Slack `action_id`s so we can distinguish OUR buttons
 * from anything else the workspace might inject. Format:
 * `messenger:<verb>:<arg>` — mirrors the Telegram binder's `callback_data`
 * convention so the router can reuse the same matcher.
 */
const ACTION_PREFIX = 'messenger:';

const buildSwitchButtons = (
  entries: AgentPickerEntry[],
): Array<{ actionId: string; style?: 'primary'; text: string; value: string }> =>
  entries.map((entry) => ({
    actionId: `${ACTION_PREFIX}switch:${entry.id}`,
    text: entry.isActive ? `✅ ${entry.title}` : entry.title,
    value: entry.id,
    ...(entry.isActive ? { style: 'primary' as const } : {}),
  }));

const buildVerifyImUrl = (params: {
  appUrl: string;
  platformUserId: string;
  randomId: string;
}): string => {
  const url = new URL('/verify-im', params.appUrl);
  url.searchParams.set('im_type', 'slack');
  url.searchParams.set('im_user_id', params.platformUserId);
  url.searchParams.set('random_id', params.randomId);
  url.searchParams.set('utm_source', 'messenger_slack');
  return url.toString();
};

export class MessengerSlackBinder implements MessengerPlatformBinder {
  createClient(): PlatformClient | null {
    const config = getMessengerSlackConfig();
    if (!config) return null;

    return new SlackClientFactory().createClient(
      {
        applicationId: 'messenger-slack',
        credentials: {
          botToken: config.botToken,
          signingSecret: config.signingSecret ?? '',
        },
        platform: 'slack',
        settings: {},
      },
      { appUrl: appEnv.WEBHOOK_PUBLIC_URL },
    );
  }

  /**
   * Slack delivers events to a webhook URL configured in the Slack App
   * settings UI ("Event Subscriptions" → "Request URL"); there is no API to
   * register it programmatically. We log so operators can confirm the URL
   * the bot expects matches what's configured upstream.
   */
  async registerWebhook(params: { webhookUrl: string }): Promise<void> {
    log(
      'registerWebhook: slack webhook URL must be set in the Slack App console -> %s',
      params.webhookUrl,
    );
  }

  async handleUnlinkedMessage(ctx: UnlinkedMessageContext): Promise<void> {
    const config = getMessengerSlackConfig();
    if (!config) return;

    // The verify-im button takes the user back into LobeHub for the auth /
    // session-bound binding flow, so it must use APP_URL — same as every other
    // app-side redirect — not the webhook tunnel URL.
    const appUrl = appEnv.APP_URL;
    if (!appUrl) {
      log('handleUnlinkedMessage: APP_URL not set, cannot build verify-im link');
      return;
    }

    let randomId: string;
    try {
      randomId = await issueLinkToken({
        platform: 'slack',
        platformUserId: ctx.authorUserId,
        platformUsername: ctx.authorUserName,
      });
    } catch (error) {
      log('handleUnlinkedMessage: failed to issue link token: %O', error);
      const api = new SlackApi(config.botToken);
      await api.postMessage(
        ctx.chatId,
        'LobeHub is temporarily unavailable. Please try again in a moment.',
      );
      return;
    }

    const verifyUrl = buildVerifyImUrl({
      appUrl,
      platformUserId: ctx.authorUserId,
      randomId,
    });

    const text =
      'Welcome to LobeHub! :robot_face:\n\nTo continue, link your Slack account to LobeHub.\n\nTap the button below — the link expires in 30 minutes.\n\nAfter linking, send `/agents` anytime to list your agents and switch the active one.';

    const api = new SlackApi(config.botToken);
    await api.postMessageWithUrlButton(ctx.chatId, text, {
      text: ':link: Link Account',
      url: verifyUrl,
    });
  }

  async notifyLinkSuccess(params: {
    activeAgentName?: string;
    platformUserId: string;
  }): Promise<void> {
    const config = getMessengerSlackConfig();
    if (!config) return;

    const api = new SlackApi(config.botToken);
    const headline =
      ':white_check_mark: Linked successfully! Your LobeHub account is now connected.';
    const tail = params.activeAgentName
      ? `\n\nActive agent: *${params.activeAgentName}*\n\nGo ahead and send your first message — send \`/agents\` any time to switch the active agent.`
      : '\n\nSend `/agents` to list your agents and pick the active one.';

    try {
      // Slack accepts a user ID as the `channel` argument and auto-routes to
      // the bot's IM with that user (requires `im:write` scope on the app).
      await api.postMessage(params.platformUserId, `${headline}${tail}`);
    } catch (error) {
      log('notifyLinkSuccess: failed to send message to %s: %O', params.platformUserId, error);
    }
  }

  async sendDmText(chatId: string, text: string): Promise<void> {
    const config = getMessengerSlackConfig();
    if (!config) return;
    try {
      await new SlackApi(config.botToken).postMessage(chatId, text);
    } catch (error) {
      log('sendDmText: failed to send to chat=%s: %O', chatId, error);
    }
  }

  async sendAgentPicker(
    chatId: string,
    params: { entries: AgentPickerEntry[]; text: string },
  ): Promise<void> {
    const config = getMessengerSlackConfig();
    if (!config) return;
    try {
      const api = new SlackApi(config.botToken);
      await api.postMessageWithButtonGrid(chatId, params.text, buildSwitchButtons(params.entries));
    } catch (error) {
      log('sendAgentPicker: failed for chat=%s: %O', chatId, error);
    }
  }

  /**
   * Pull our `messenger:switch:<agentId>` action out of a Slack interactive
   * webhook payload. Slack delivers `block_actions` as
   * `application/x-www-form-urlencoded` with a single `payload` field whose
   * value is JSON, so we have to parse the body here rather than relying on
   * the router's JSON-only path. Returns null for any other update so the
   * caller can hand off to chat-sdk.
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
      // `response_url` is what we use to ack — Slack accepts up to 5 calls
      // within 30 minutes per response_url and applies the update to the
      // exact message that triggered the action.
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
    const config = getMessengerSlackConfig();
    if (!config) return;
    const api = new SlackApi(config.botToken);

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
}
