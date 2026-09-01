import type { TelegramRawMessage } from '@chat-adapter/telegram';
import { TelegramAdapter } from '@chat-adapter/telegram';
import type { AdapterPostableMessage, RawMessage, WebhookOptions } from 'chat';
import { Message } from 'chat';
import debug from 'debug';

import { normalizeBotReplyLocale } from '../const';
import { TelegramApi } from './api';
import {
  deliverGuestCreate,
  deliverGuestEdit,
  messengerContentFromPostable,
} from './guestOutbound';
import { initializeTelegramGuestSession } from './guestSession';
import {
  encodeGuestTelegramThreadId,
  isGuestTelegramThreadId,
  parseTelegramThreadId,
} from './threadId';

const log = debug('lobe-server:bot:telegram-guest-adapter');

interface TelegramGuestUser {
  first_name?: string;
  id: number;
  is_bot?: boolean;
  language_code?: string;
  last_name?: string;
  username?: string;
}

interface TelegramGuestChat {
  id: number;
  title?: string;
  type: string;
  username?: string;
}

interface TelegramGuestMessage {
  [key: string]: unknown;
  caption?: string;
  chat: TelegramGuestChat;
  from?: TelegramGuestUser;
  guest_bot_caller_user?: TelegramGuestUser;
  guest_query_id?: string;
  message_id: number;
  message_thread_id?: number;
  reply_to_message?: TelegramGuestMessage;
  text?: string;
}

interface TelegramGuestUpdate {
  guest_message?: TelegramGuestMessage;
}

/**
 * Extends the Chat SDK Telegram adapter with Guest Mode:
 *
 * - inbound `guest_message` updates become mentions on `telegram:guest:{chatId}`
 * - outbound `post` / `edit` on those threads use `answerGuestQuery` /
 *   `editMessageText({ inline_message_id })` instead of `sendMessage`
 *
 * Why this is a dedicated adapter wrapper instead of handling Guest Mode in
 * the regular Telegram client:
 *
 * - We still reuse the upstream `TelegramAdapter` for every normal update and
 *   operation through inheritance and the `super.*` fallbacks below. Keeping
 *   that path untouched lets Chat SDK continue owning ordinary Telegram
 *   parsing, thread IDs, sends, typing indicators, and reactions.
 * - Guest Mode is a different Telegram transport, not just another message
 *   subtype. Its inbound update is `guest_message`, while its first outbound
 *   response must consume `guest_query_id` with `answerGuestQuery`. Later
 *   chunks edit the returned `inline_message_id`; `sendMessage` cannot work
 *   because the bot is not a member of the source chat.
 * - Guest inline messages have no normal Telegram message payload and do not
 *   support chat-scoped operations such as typing or reactions. They also need
 *   bot-scoped synthetic thread/message IDs plus a short-lived session that
 *   bridges `guest_query_id` to `inline_message_id`.
 *
 * Isolating those protocol exceptions here avoids forking or teaching the
 * upstream adapter about LobeHub session state, while preserving one adapter
 * instance and one Chat SDK dispatch pipeline for both Telegram transports.
 */
export class LobeTelegramAdapter extends TelegramAdapter {
  private readonly sessionScope: string;

  constructor(config: ConstructorParameters<typeof TelegramAdapter>[0], sessionScope: string) {
    super(config);
    this.sessionScope = sessionScope;
  }

  protected override processUpdate(update: unknown, options?: WebhookOptions): void {
    const guestMessage = (update as TelegramGuestUpdate).guest_message;
    if (guestMessage) {
      const senderId = guestMessage.guest_bot_caller_user?.id ?? guestMessage.from?.id;
      if (
        this.allowedUserIds &&
        (senderId === undefined || !this.allowedUserIds.has(String(senderId)))
      ) {
        return;
      }
      this.handleGuestMessage(guestMessage, options);
      return;
    }
    super.processUpdate(update as never, options);
  }

  override isDM(threadId: string): boolean {
    if (isGuestTelegramThreadId(threadId)) return false;
    return super.isDM(threadId);
  }

  override decodeThreadId(threadId: string) {
    if (isGuestTelegramThreadId(threadId)) {
      const parsed = parseTelegramThreadId(threadId);
      return { chatId: parsed.chatId, messageThreadId: parsed.messageThreadId };
    }
    return super.decodeThreadId(threadId);
  }

  override channelIdFromThreadId(threadId: string): string {
    if (isGuestTelegramThreadId(threadId)) {
      const parsed = parseTelegramThreadId(threadId);
      const botScope = parsed.guestBotId ? `:bot:${parsed.guestBotId}` : '';
      return parsed.guestMessageId
        ? `telegram:guest:${parsed.chatId}${botScope}:message:${parsed.guestMessageId}`
        : `telegram:guest:${parsed.chatId}${botScope}`;
    }
    return super.channelIdFromThreadId(threadId);
  }

  override async postMessage(
    threadId: string,
    message: AdapterPostableMessage,
    replyToMessageId?: string,
  ): Promise<RawMessage<TelegramRawMessage>> {
    if (!isGuestTelegramThreadId(threadId)) {
      return super.postMessage(threadId, message, replyToMessageId);
    }
    const api = new TelegramApi(await this.resolveBotToken());
    const sent = await deliverGuestCreate(
      api,
      this.sessionScope,
      threadId,
      messengerContentFromPostable(message),
    );
    // Guest replies are inline messages owned by the summoning user's client;
    // Telegram never returns a raw message payload for them. Only the encoded
    // inline_message_id (`sent.id`) is meaningful - consumers must not read
    // fields off `raw` for guest sends. (Inbound guest messages DO carry a
    // full raw payload; see `handleGuestMessage` / `getTelegramGuestQueryId`.)
    return { id: sent.id, raw: {} as TelegramRawMessage, threadId };
  }

  override async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage,
  ): Promise<RawMessage<TelegramRawMessage>> {
    if (!isGuestTelegramThreadId(threadId)) {
      return super.editMessage(threadId, messageId, message);
    }
    const api = new TelegramApi(await this.resolveBotToken());
    await deliverGuestEdit(
      api,
      this.sessionScope,
      threadId,
      messageId,
      messengerContentFromPostable(message),
    );
    // Same as postMessage: inline-message edits have no raw payload, only
    // the already-encoded inline_message_id echoed back as `id`.
    return { id: messageId, raw: {} as TelegramRawMessage, threadId };
  }

  override async startTyping(threadId: string): Promise<void> {
    if (isGuestTelegramThreadId(threadId)) return;
    await super.startTyping(threadId);
  }

  override async addReaction(
    threadId: string,
    messageId: string,
    emoji: Parameters<TelegramAdapter['addReaction']>[2],
  ): Promise<void> {
    if (isGuestTelegramThreadId(threadId)) return;
    await super.addReaction(threadId, messageId, emoji);
  }

  override async removeReaction(
    threadId: string,
    messageId: string,
    emoji: Parameters<TelegramAdapter['removeReaction']>[2],
  ): Promise<void> {
    if (isGuestTelegramThreadId(threadId)) return;
    await super.removeReaction(threadId, messageId, emoji);
  }

  private handleGuestMessage(guestMessage: TelegramGuestMessage, options?: WebhookOptions): void {
    if (!this.chat) return;

    const caller = guestMessage.guest_bot_caller_user ?? guestMessage.from;
    const normalized = {
      ...guestMessage,
      from: caller,
    };
    const threadId = encodeGuestTelegramThreadId(
      String(guestMessage.chat.id),
      this.sessionScope,
      guestMessage.message_id,
      guestMessage.message_thread_id,
    );

    const guestQueryId = guestMessage.guest_query_id;
    const dispatch = async () => {
      if (guestQueryId) {
        // Remember the summoning user's Telegram locale so Guest Mode
        // notices (truncation / attachment fallbacks) render in their
        // language on the first reply and every later edit.
        await initializeTelegramGuestSession(this.sessionScope, threadId, {
          guestQueryId,
          locale: normalizeBotReplyLocale(caller?.language_code),
        });
      }
      if (!this.chat) return;
      const parsed = this.parseTelegramMessage(normalized as never, threadId);
      const message = forceGuestMention(parsed as Message, this.sessionScope);
      this.chat.processMessage(this, threadId, message, options);
    };

    const task = dispatch().catch((error) => {
      log('failed to dispatch guest message: %O', error);
    });
    options?.waitUntil?.(task);
  }
}

const forceGuestMention = (parsed: Message, sessionScope: string): Message => {
  try {
    return new Message({
      attachments: parsed.attachments,
      author: parsed.author,
      formatted: parsed.formatted,
      id: `guest:${sessionScope}:${parsed.id}`,
      isMention: true,
      links: parsed.links,
      metadata: parsed.metadata,
      raw: parsed.raw,
      replyTo: parsed.replyTo,
      text: parsed.text,
      threadId: parsed.threadId,
    });
  } catch (error) {
    log('failed to clone guest message with isMention, mutating: %O', error);
    const mutable = parsed as { id: string; isMention: boolean };
    mutable.id = `guest:${sessionScope}:${parsed.id}`;
    mutable.isMention = true;
    return parsed;
  }
};

export const createLobeTelegramAdapter = (
  config: ConstructorParameters<typeof TelegramAdapter>[0],
  sessionScope: string,
): LobeTelegramAdapter => new LobeTelegramAdapter(config, sessionScope);
