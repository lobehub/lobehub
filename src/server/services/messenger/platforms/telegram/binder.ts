import debug from 'debug';

import { getMessengerTelegramConfig } from '@/config/messenger';
import { appEnv } from '@/envs/app';
import type { PlatformClient } from '@/server/services/bot/platforms';
import { TelegramApi } from '@/server/services/bot/platforms/telegram/api';
import { TelegramClientFactory } from '@/server/services/bot/platforms/telegram/client';

import { issueLinkToken } from '../../linkTokenStore';
import type {
  AgentPickerEntry,
  CallbackAcknowledgement,
  InboundCallbackAction,
  MessengerPlatformBinder,
  UnlinkedMessageContext,
} from '../../types';

/**
 * Application prefix on Telegram callback_data so we can distinguish OUR
 * buttons from anything else the user (or another bot in the same chat)
 * might inject. Format: `messenger:<verb>:<arg>`.
 */
const CALLBACK_PREFIX = 'messenger:';

const buildSwitchKeyboard = (
  entries: AgentPickerEntry[],
): Array<Array<{ callback_data: string; text: string }>> =>
  entries.map((entry) => [
    {
      callback_data: `${CALLBACK_PREFIX}switch:${entry.id}`,
      text: entry.isActive ? `✅ ${entry.title}` : entry.title,
    },
  ]);

const log = debug('lobe-server:messenger:telegram');

const buildVerifyImUrl = (params: {
  appUrl: string;
  platformUserId: string;
  randomId: string;
}): string => {
  const url = new URL('/verify-im', params.appUrl);
  url.searchParams.set('im_type', 'telegram');
  url.searchParams.set('im_user_id', params.platformUserId);
  url.searchParams.set('random_id', params.randomId);
  url.searchParams.set('utm_source', 'messenger_tg');
  return url.toString();
};

// Telegram rejects inline-keyboard URL buttons whose host is not publicly
// resolvable (e.g. `localhost`, `127.0.0.1`) with `Bad Request: Wrong HTTP URL`.
// In local dev we fall back to a plain text message so the flow is still
// testable without a public tunnel.
const isLocalhostUrl = (raw: string): boolean => {
  try {
    const { hostname } = new URL(raw);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1'
    );
  } catch {
    return false;
  }
};

const escapeHtml = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export class MessengerTelegramBinder implements MessengerPlatformBinder {
  async createClient(): Promise<PlatformClient | null> {
    const config = await getMessengerTelegramConfig();
    if (!config) return null;

    return new TelegramClientFactory().createClient(
      {
        applicationId: 'messenger-telegram',
        credentials: {
          botToken: config.botToken,
          secretToken: config.webhookSecret ?? '',
        },
        platform: 'telegram',
        settings: {},
      },
      { appUrl: appEnv.APP_URL },
    );
  }

  async handleUnlinkedMessage(ctx: UnlinkedMessageContext): Promise<void> {
    const config = await getMessengerTelegramConfig();
    if (!config) return;

    // The verify-im button takes the user back into LobeHub for the auth /
    // session-bound binding flow, so it must use APP_URL — same as every other
    // app-side redirect — not the webhook tunnel URL. (Tunnel URLs are only
    // used for inbound platform → server webhooks.)
    const appUrl = appEnv.APP_URL;
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
        'LobeHub is temporarily unavailable. Please try again in a moment.',
      );
      return;
    }

    const verifyUrl = buildVerifyImUrl({
      appUrl,
      platformUserId: ctx.authorUserId,
      randomId,
    });

    const api = new TelegramApi(config.botToken);

    if (isLocalhostUrl(verifyUrl)) {
      log('handleUnlinkedMessage: APP_URL is localhost, falling back to plain text link');
      const text = `Welcome to LobeHub! 🤖\n\nTo continue, link your Telegram account to LobeHub. The link expires in 30 minutes:\n\n${verifyUrl}\n\nAfter linking, send /agents anytime to list your agents and tap one to switch the active agent.`;
      await api.sendMessage(ctx.chatId, text);
      return;
    }

    const text =
      'Welcome to LobeHub! 🤖\n\nTo continue, link your Telegram account to LobeHub.\n\nTap the button below — the link expires in 30 minutes.\n\nAfter linking, send /agents anytime to list your agents and tap one to switch the active agent.';

    await api.sendMessageWithUrlButton(ctx.chatId, text, {
      text: '🔗 Link Account',
      url: verifyUrl,
    });
  }

  async notifyLinkSuccess(params: {
    activeAgentName?: string;
    platformUserId: string;
    /** Ignored — Telegram is a global-token bot, no tenant scoping needed. */
    tenantId?: string;
  }): Promise<void> {
    const config = await getMessengerTelegramConfig();
    if (!config) return;

    const api = new TelegramApi(config.botToken);
    const headline = '✅ Linked successfully! Your LobeHub account is now connected.';
    const tail = params.activeAgentName
      ? `\n\nActive agent: <b>${escapeHtml(params.activeAgentName)}</b>\n\nGo ahead and send your first message — send /agents any time to switch the active agent.`
      : '\n\nSend /agents to list your agents and tap one to set it as active.';

    try {
      await api.sendMessage(params.platformUserId, `${headline}${tail}`);
    } catch (error) {
      log('notifyLinkSuccess: failed to send message to %s: %O', params.platformUserId, error);
    }
  }

  async sendDmText(chatId: string, text: string): Promise<void> {
    const config = await getMessengerTelegramConfig();
    if (!config) return;
    try {
      // TelegramApi.sendMessage uses parse_mode='HTML' under the hood.
      // sendDmText is for plain text replies (command help, agent lists, etc.)
      // so we escape `< > &` to prevent literal characters like "/agents <n>"
      // from being interpreted as HTML tags.
      await new TelegramApi(config.botToken).sendMessage(chatId, escapeHtml(text));
    } catch (error) {
      log('sendDmText: failed to send to chat=%s: %O', chatId, error);
    }
  }

  async sendAgentPicker(
    chatId: string,
    params: { entries: AgentPickerEntry[]; text: string },
  ): Promise<void> {
    const config = await getMessengerTelegramConfig();
    if (!config) return;
    try {
      const api = new TelegramApi(config.botToken);
      await api.sendMessageWithCallbackKeyboard(
        chatId,
        escapeHtml(params.text),
        buildSwitchKeyboard(params.entries),
      );
    } catch (error) {
      log('sendAgentPicker: failed for chat=%s: %O', chatId, error);
    }
  }

  /**
   * Pull our `messenger:switch:<agentId>` action out of a Telegram webhook
   * update. Returns null when the update is anything else (regular message,
   * other bot's callback, malformed data) so the router can hand off to
   * chat-sdk for normal processing.
   */
  async extractCallbackAction(req: Request): Promise<InboundCallbackAction | null> {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return null;
    }
    if (!rawBody || typeof rawBody !== 'object') return null;
    const cb = (rawBody as any).callback_query;
    if (!cb) return null;

    const data = String(cb.data ?? '');
    if (!data.startsWith(CALLBACK_PREFIX)) return null;

    const fromUserId = cb.from?.id != null ? String(cb.from.id) : '';
    const chatId = cb.message?.chat?.id != null ? String(cb.message.chat.id) : '';
    const messageId = cb.message?.message_id;
    const callbackId = String(cb.id ?? '');
    if (!fromUserId || !chatId || !callbackId) return null;

    return { callbackId, chatId, data, fromUserId, messageId };
  }

  async acknowledgeCallback(
    action: InboundCallbackAction,
    ack: CallbackAcknowledgement,
  ): Promise<void> {
    const config = await getMessengerTelegramConfig();
    if (!config) return;
    const api = new TelegramApi(config.botToken);

    // Re-render the picker first so the user sees the new active marker
    // before the toast fires (and even if the toast fails).
    if (ack.updatedPicker && action.messageId !== undefined) {
      const messageId =
        typeof action.messageId === 'string' ? Number(action.messageId) : action.messageId;
      if (Number.isFinite(messageId)) {
        try {
          await api.editMessageWithCallbackKeyboard(
            action.chatId,
            messageId as number,
            escapeHtml(ack.updatedPicker.text),
            buildSwitchKeyboard(ack.updatedPicker.entries),
          );
        } catch (error) {
          log('acknowledgeCallback: edit picker failed: %O', error);
        }
      }
    }

    try {
      await api.answerCallbackQuery(action.callbackId, ack.toast);
    } catch (error) {
      log('acknowledgeCallback: answerCallbackQuery failed: %O', error);
    }
  }
}
