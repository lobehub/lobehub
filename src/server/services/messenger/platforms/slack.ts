import debug from 'debug';

import { getMessengerSlackConfig } from '@/config/messenger';
import { appEnv } from '@/envs/app';
import type { PlatformClient } from '@/server/services/bot/platforms';
import { SlackApi } from '@/server/services/bot/platforms/slack/api';
import { SlackClientFactory } from '@/server/services/bot/platforms/slack/client';

import { issueLinkToken } from '../linkTokenStore';
import type { MessengerPlatformBinder, UnlinkedMessageContext } from '../types';

const log = debug('lobe-server:messenger:slack');

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
      'Welcome to LobeHub! :robot_face:\n\nTo continue, link your Slack account to LobeHub.\n\nTap the button below — the link expires in 30 minutes.\n\nAfter linking, use:\n• `/agents` to list your agents\n• `/switch <n>` to change the active one';

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
      ? `\n\nActive agent: *${params.activeAgentName}*\n\nGo ahead and send your first message — use \`/switch <n>\` any time to change agents.`
      : '\n\nUse `/agents` to list your agents and `/switch <n>` to pick the active one.';

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
}
