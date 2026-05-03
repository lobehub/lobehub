import debug from 'debug';

import { getMessengerDiscordConfig } from '@/config/messenger';
import { appEnv } from '@/envs/app';
import type { PlatformClient } from '@/server/services/bot/platforms';
import { DiscordApi } from '@/server/services/bot/platforms/discord/api';
import { DiscordClientFactory } from '@/server/services/bot/platforms/discord/client';

import { issueLinkToken } from '../linkTokenStore';
import type { MessengerPlatformBinder, UnlinkedMessageContext } from '../types';

const log = debug('lobe-server:messenger:discord');

const buildVerifyImUrl = (params: {
  appUrl: string;
  platformUserId: string;
  randomId: string;
}): string => {
  const url = new URL('/verify-im', params.appUrl);
  url.searchParams.set('im_type', 'discord');
  url.searchParams.set('im_user_id', params.platformUserId);
  url.searchParams.set('random_id', params.randomId);
  url.searchParams.set('utm_source', 'messenger_discord');
  return url.toString();
};

/**
 * Open (or fetch the existing) DM channel between the bot and the user.
 *
 * Discord requires a channel id for `createMessage`; for outbound DMs we
 * therefore have to create the DM channel first via `POST /users/@me/channels`
 * (idempotent — re-calling for a user with an open DM returns the same id).
 *
 * Throws if the user has DMs disabled or doesn't share a guild with the
 * bot. Callers swallow + log so a single bad recipient doesn't crash the
 * link confirmation flow.
 */
const openDM = async (api: DiscordApi, recipientId: string): Promise<string | null> => {
  try {
    const dm = await api.createDMChannel(recipientId);
    return dm.id;
  } catch (error) {
    log('openDM: failed for recipient=%s: %O', recipientId, error);
    return null;
  }
};

/**
 * Discord messenger binder.
 *
 * Single global bot — there is no per-guild token exchange — so the binder
 * reads credentials from env on every call (mirrors Telegram's binder), with
 * no `creds` parameter to thread through. The router still creates one
 * binder instance per `installationKey`, but that key is the singleton
 * `discord:singleton` in this case.
 *
 * MVP scope is DM-only: agent picker / interactive components are not
 * implemented here, so the router falls back to the text-based
 * `/agents <n>` flow.
 */
export class MessengerDiscordBinder implements MessengerPlatformBinder {
  createClient(): PlatformClient | null {
    const config = getMessengerDiscordConfig();
    if (!config) return null;

    return new DiscordClientFactory().createClient(
      {
        applicationId: config.applicationId,
        credentials: {
          botToken: config.botToken,
          publicKey: config.publicKey,
        },
        platform: 'discord',
        settings: {},
      },
      { appUrl: appEnv.WEBHOOK_PUBLIC_URL },
    );
  }

  /**
   * Discord delivers Interactions to the URL configured in the Developer
   * Portal — there is no API to register it programmatically. Logged so
   * operators see the URL the bot expects matches what's configured upstream.
   */
  async registerWebhook(params: { webhookUrl: string }): Promise<void> {
    log(
      'registerWebhook: discord interactions URL must be set in the Developer Portal -> %s',
      params.webhookUrl,
    );
  }

  async handleUnlinkedMessage(ctx: UnlinkedMessageContext): Promise<void> {
    const config = getMessengerDiscordConfig();
    if (!config) return;

    const appUrl = appEnv.APP_URL;
    if (!appUrl) {
      log('handleUnlinkedMessage: APP_URL not set, cannot build verify-im link');
      return;
    }

    let randomId: string;
    try {
      randomId = await issueLinkToken({
        platform: 'discord',
        platformUserId: ctx.authorUserId,
        platformUsername: ctx.authorUserName,
      });
    } catch (error) {
      log('handleUnlinkedMessage: failed to issue link token: %O', error);
      const api = new DiscordApi(config.botToken);
      try {
        await api.createMessage(
          ctx.chatId,
          'LobeHub is temporarily unavailable. Please try again in a moment.',
        );
      } catch (err) {
        log('handleUnlinkedMessage: fallback createMessage failed: %O', err);
      }
      return;
    }

    const verifyUrl = buildVerifyImUrl({
      appUrl,
      platformUserId: ctx.authorUserId,
      randomId,
    });

    // Discord DMs render plain markdown — `[label](url)` becomes a clickable
    // link. Components (interactive buttons) require us to ack the original
    // interaction within 3s, which is incompatible with the messenger flow
    // where the unlinked message handler runs after the chat-sdk has already
    // dispatched the message — so we stick to a markdown link for v1.
    const text = [
      "Hi, I'm LobeHub — your AI agent in Discord.",
      'To start, link your LobeHub account.',
      '',
      `🔗 [Link Account](${verifyUrl})`,
      '',
      `Or copy this link: ${verifyUrl}`,
    ].join('\n');

    const api = new DiscordApi(config.botToken);
    try {
      await api.createMessage(ctx.chatId, text);
    } catch (error) {
      log('handleUnlinkedMessage: createMessage failed: %O', error);
    }
  }

  async notifyLinkSuccess(params: {
    activeAgentName?: string;
    platformUserId: string;
    /** Ignored — Discord is a global-token bot, no tenant scoping needed. */
    tenantId?: string;
  }): Promise<void> {
    const config = getMessengerDiscordConfig();
    if (!config) return;

    const api = new DiscordApi(config.botToken);
    const dmChannelId = await openDM(api, params.platformUserId);
    if (!dmChannelId) return;

    const headline = '✅ Linked successfully! Your LobeHub account is now connected.';
    const tail = params.activeAgentName
      ? `\n\nActive agent: **${params.activeAgentName}**\n\nGo ahead and send your first message — send \`/agents\` any time to switch the active agent.`
      : '\n\nSend `/agents` to list your agents and pick the active one.';

    try {
      await api.createMessage(dmChannelId, `${headline}${tail}`);
    } catch (error) {
      log('notifyLinkSuccess: failed to send to %s: %O', params.platformUserId, error);
    }
  }

  async sendDmText(chatId: string, text: string): Promise<void> {
    const config = getMessengerDiscordConfig();
    if (!config) return;
    try {
      await new DiscordApi(config.botToken).createMessage(chatId, text);
    } catch (error) {
      log('sendDmText: failed to send to chat=%s: %O', chatId, error);
    }
  }
}
