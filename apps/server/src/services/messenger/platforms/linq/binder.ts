import { extractLinqLinkCode } from '@lobechat/agent-address-linq';

import { getMessengerLinqConfig, type MessengerLinqConfig } from '@/config/messenger';
import { appEnv } from '@/envs/app';
import type { PlatformClient } from '@/server/services/bot/platforms';

import { greetAfterBind } from '../../bind/greeting';
import { type LinkByCodeOutcome, linkSenderByCode } from '../../bind/linkByCode';
import type { MessengerPlatformBinder, UnlinkedMessageContext } from '../../types';
import { LinqMessengerClient, sendLinqTextToHandle } from './client';

const settingsUrl = (): string | undefined => {
  if (!appEnv.APP_URL) return undefined;
  return new URL('/settings/messenger/linq', appEnv.APP_URL).toString();
};

/** Replies are deliberately short: they arrive as iMessage / SMS bubbles. */
export const LINQ_REPLY = {
  alreadyLinkedToOther:
    'This number is already connected to a different LobeHub account. Disconnect it there first, then send your code again.',
  codeInvalid:
    'That link code has expired or was already used. Open LobeHub → Settings → Messenger → iMessage to get a fresh one.',
  linked: (agentName?: string) =>
    agentName
      ? `You're connected to LobeHub. Messages you send here go to ${agentName}.`
      : "You're connected to LobeHub. Send a message any time.",
  needLink: (url?: string) =>
    url
      ? `Hi! This number isn't connected to LobeHub yet. Open ${url} and tap Connect — it will text us a one-time code from your phone.`
      : "Hi! This number isn't connected to LobeHub yet. Open LobeHub → Settings → Messenger → iMessage and tap Connect.",
  unlinkBeforeRelink:
    'Your LobeHub account is already connected to another number. Disconnect it in Settings → Messenger first, then send your code again.',
} as const;

/**
 * Bind `senderHandle` to whoever issued `code`. The code is consumed before
 * anything is written so a replayed or forwarded code can never link twice.
 */
export const linkLinqSenderByCode = (
  code: string,
  senderHandle: string,
): Promise<LinkByCodeOutcome> =>
  linkSenderByCode({ code, platform: 'linq', senderId: senderHandle, senderName: senderHandle });

/**
 * Binder for the shared Linq pool. Unlike Telegram/Slack — where the bot
 * learns the platform id first and the web page confirms — a Linq link starts
 * on the web: the signed-in user gets a one-time code and texts it from their
 * phone. So the unlinked path here is where a link is *completed*, and a cold
 * message without a code just gets pointed at the connect page.
 */
export class MessengerLinqBinder implements MessengerPlatformBinder {
  private async config(): Promise<MessengerLinqConfig | null> {
    return getMessengerLinqConfig();
  }

  async createClient(): Promise<PlatformClient | null> {
    const config = await this.config();
    return config ? new LinqMessengerClient(config) : null;
  }

  async handleUnlinkedMessage(ctx: UnlinkedMessageContext): Promise<void> {
    const code = extractLinqLinkCode(ctx.message?.text);
    if (!code) {
      await this.sendDmText(ctx.chatId, LINQ_REPLY.needLink(settingsUrl()));
      return;
    }

    const outcome = await linkLinqSenderByCode(code, ctx.authorUserId);
    switch (outcome.status) {
      case 'linked': {
        await this.sendDmText(ctx.chatId, LINQ_REPLY.linked());
        await greetAfterBind({
          agentId: outcome.payload.activeAgentId,
          locale: outcome.payload.locale,
          platform: 'linq',
          userId: outcome.payload.userId,
        });
        return;
      }
      case 'invalid': {
        await this.sendDmText(ctx.chatId, LINQ_REPLY.codeInvalid);
        return;
      }
      case 'already_linked_to_other': {
        await this.sendDmText(ctx.chatId, LINQ_REPLY.alreadyLinkedToOther);
        return;
      }
      case 'unlink_before_relink': {
        await this.sendDmText(ctx.chatId, LINQ_REPLY.unlinkBeforeRelink);
        return;
      }
    }
  }

  async notifyLinkSuccess(params: {
    activeAgentName?: string;
    platformUserId: string;
  }): Promise<void> {
    await this.sendDmText(params.platformUserId, LINQ_REPLY.linked(params.activeAgentName));
  }

  /** `chatId` is a Linq chat id on the inbound path, or a handle for proactive sends. */
  async sendDmText(chatId: string, text: string): Promise<void> {
    const config = await this.config();
    if (!config) return;
    if (chatId.startsWith('+') || chatId.includes('@')) {
      await sendLinqTextToHandle(config, chatId, text);
      return;
    }
    await new LinqMessengerClient(config).getMessenger(`linq:${chatId}`).createMessage(text);
  }
}
