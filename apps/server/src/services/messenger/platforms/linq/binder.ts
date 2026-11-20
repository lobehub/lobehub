import { extractLinqLinkCode } from '@lobechat/agent-address-linq';
import debug from 'debug';

import { getMessengerLinqConfig, type MessengerLinqConfig } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import {
  MessengerAccountLinkConflictError,
  MessengerAccountLinkModel,
  MessengerAccountLinkRelinkRequiredError,
} from '@/database/models/messengerAccountLink';
import { appEnv } from '@/envs/app';
import type { PlatformClient } from '@/server/services/bot/platforms';

import {
  consumeLinkCode,
  type LinkCodePayload,
  restoreLinkCode,
  settleLinkCode,
} from '../../linkTokenStore';
import type { MessengerPlatformBinder, UnlinkedMessageContext } from '../../types';
import { LinqMessengerClient, sendLinqTextToHandle } from './client';

const log = debug('lobe-server:messenger:linq:binder');

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

type LinkOutcome =
  | { activeAgentId: string | null; status: 'linked' }
  | { status: 'already_linked_to_other' | 'invalid' | 'unlink_before_relink' };

/**
 * Bind `senderHandle` to whoever issued `code`. The code is consumed before
 * anything is written so a replayed or forwarded code can never link twice.
 */
export const linkLinqSenderByCode = async (
  code: string,
  senderHandle: string,
): Promise<LinkOutcome> => {
  const payload = await consumeLinkCode(code, 'linq');
  if (!payload) return { status: 'invalid' };

  try {
    return await bindConsumedCode(payload, senderHandle);
  } catch (error) {
    // The code was taken atomically, but nothing got bound. Put it back so
    // resending the same code (or the delivery retry) can still complete.
    await restoreLinkCode(code, payload).catch((restoreError: unknown) => {
      log('restoreLinkCode failed: %O', restoreError);
    });
    throw error;
  }
};

const bindConsumedCode = async (
  payload: LinkCodePayload,
  senderHandle: string,
): Promise<LinkOutcome> => {
  const serverDB = await getServerDB();
  const owner = await MessengerAccountLinkModel.findByPlatformUser(
    serverDB,
    'linq',
    senderHandle,
    '',
  );
  if (owner && owner.userId !== payload.userId) {
    await settleLinkCode(payload.pollId, {
      reason: 'already_linked_to_other',
      status: 'failed',
    });
    return { status: 'already_linked_to_other' };
  }

  try {
    await new MessengerAccountLinkModel(serverDB, payload.userId).upsertForPlatform({
      activeAgentId: payload.activeAgentId,
      platform: 'linq',
      platformUserId: senderHandle,
      platformUsername: senderHandle,
      tenantId: '',
      workspaceId: payload.workspaceId,
    });
  } catch (error) {
    const reason =
      error instanceof MessengerAccountLinkConflictError
        ? ('already_linked_to_other' as const)
        : error instanceof MessengerAccountLinkRelinkRequiredError
          ? ('unlink_before_relink' as const)
          : undefined;
    if (!reason) throw error;
    await settleLinkCode(payload.pollId, { reason, status: 'failed' });
    return { status: reason };
  }

  // The link is committed. A failed poll-status write must not reach the
  // caller's restore path — that would resurrect a code for a sender who now
  // routes as linked, so the page would wait on it until expiry.
  try {
    await settleLinkCode(payload.pollId, {
      linkedAt: Date.now(),
      platformUserId: senderHandle,
      status: 'linked',
    });
  } catch (error) {
    log('settleLinkCode after link failed: %O', error);
  }
  log('linked linq sender for user=%s', payload.userId);
  return { activeAgentId: payload.activeAgentId, status: 'linked' };
};

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
