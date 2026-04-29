import debug from 'debug';

import { getLobeAITelegramConfig } from '@/config/lobeai';
import type { PlatformClient } from '@/server/services/bot/platforms';
import { TelegramApi } from '@/server/services/bot/platforms/telegram/api';
import { TelegramClientFactory } from '@/server/services/bot/platforms/telegram/client';

import { issueLinkToken } from '../linkTokenStore';
import type { LobeAIPlatformBinder, UnlinkedMessageContext } from '../types';

const log = debug('lobe-server:lobeai:telegram');

const buildVerifyImUrl = (params: {
  appUrl: string;
  platformUserId: string;
  randomId: string;
}): string => {
  const url = new URL('/verify-im', params.appUrl);
  url.searchParams.set('im_type', 'telegram');
  url.searchParams.set('im_user_id', params.platformUserId);
  url.searchParams.set('random_id', params.randomId);
  url.searchParams.set('utm_source', 'lobeai_tg');
  return url.toString();
};

const escapeHtml = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export class LobeAITelegramBinder implements LobeAIPlatformBinder {
  createClient(): PlatformClient | null {
    const config = getLobeAITelegramConfig();
    if (!config) return null;

    return new TelegramClientFactory().createClient(
      {
        applicationId: 'lobeai-telegram',
        credentials: {
          botToken: config.botToken,
          secretToken: config.webhookSecret ?? '',
        },
        platform: 'telegram',
        settings: {},
      },
      { appUrl: process.env.APP_URL },
    );
  }

  async handleUnlinkedMessage(ctx: UnlinkedMessageContext): Promise<void> {
    const config = getLobeAITelegramConfig();
    if (!config) return;

    const appUrl = process.env.APP_URL;
    if (!appUrl) {
      log('handleUnlinkedMessage: APP_URL not set, cannot build verify-im link');
      return;
    }

    let randomId: string;
    try {
      randomId = await issueLinkToken({
        platform: 'telegram',
        platformUserId: ctx.authorUserId,
        platformUsername: ctx.authorUserName,
      });
    } catch (error) {
      log('handleUnlinkedMessage: failed to issue link token: %O', error);
      const api = new TelegramApi(config.botToken);
      await api.sendMessage(
        ctx.chatId,
        'LobeAI is temporarily unavailable. Please try again in a moment.',
      );
      return;
    }

    const verifyUrl = buildVerifyImUrl({
      appUrl,
      platformUserId: ctx.authorUserId,
      randomId,
    });

    const text =
      'Welcome to LobeAI! 🤖\n\nTo continue, link your Telegram account to LobeHub.\n\nTap the button below — the link expires in 30 minutes.\n\nAfter linking, use:\n• /agents to list your agents\n• /switch &lt;n&gt; to change the active one';

    const api = new TelegramApi(config.botToken);
    await api.sendMessageWithUrlButton(ctx.chatId, text, {
      text: '🔗 Link Account',
      url: verifyUrl,
    });
  }

  async notifyLinkSuccess(params: {
    activeAgentName?: string;
    platformUserId: string;
  }): Promise<void> {
    const config = getLobeAITelegramConfig();
    if (!config) return;

    const api = new TelegramApi(config.botToken);
    const headline = '✅ Linked successfully! Your LobeAI account is now connected.';
    const tail = params.activeAgentName
      ? `\n\nActive agent: <b>${escapeHtml(params.activeAgentName)}</b>\n\nGo ahead and send your first message — use /switch &lt;n&gt; any time to change agents.`
      : '\n\nUse /agents to list your agents and /switch &lt;n&gt; to pick the active one.';

    try {
      await api.sendMessage(params.platformUserId, `${headline}${tail}`);
    } catch (error) {
      log('notifyLinkSuccess: failed to send message to %s: %O', params.platformUserId, error);
    }
  }

  async sendDmText(chatId: string, text: string): Promise<void> {
    const config = getLobeAITelegramConfig();
    if (!config) return;
    try {
      await new TelegramApi(config.botToken).sendMessage(chatId, text);
    } catch (error) {
      log('sendDmText: failed to send to chat=%s: %O', chatId, error);
    }
  }
}
