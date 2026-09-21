/**
 * Telegram Chat SDK thread ids:
 *
 * - `telegram:{chatId}` — bot is a member of the chat
 * - `telegram:{chatId}:{messageThreadId}` — forum topic in a member chat
 * - `telegram:guest:{chatId}:bot:{botId}:message:{messageId}` — one Guest Mode summon
 * - `telegram:guest:{chatId}:bot:{botId}:message:{messageId}:{messageThreadId}`
 *   — guest summon inside a topic
 *
 * Guest chats MUST NOT share identity with a member chat of the same numeric
 * id — Telegram documents that the two are independent even when the numbers
 * coincide.
 */

const PLATFORM = 'telegram';
const GUEST_SEGMENT = 'guest';

export const TELEGRAM_GUEST_INLINE_ID_PREFIX = 'guest-inline:';

export interface ParsedTelegramThreadId {
  chatId: string;
  guest: boolean;
  guestBotId?: string;
  guestMessageId?: string;
  messageThreadId?: number;
}

export const isGuestTelegramThreadId = (threadId: string): boolean =>
  threadId.startsWith(`${PLATFORM}:${GUEST_SEGMENT}:`);

export const encodeGuestTelegramThreadId = (
  chatId: string,
  botId: string,
  messageId: string | number,
  messageThreadId?: number,
): string => {
  const base = `${PLATFORM}:${GUEST_SEGMENT}:${chatId}:bot:${botId}:message:${messageId}`;
  return typeof messageThreadId === 'number' ? `${base}:${messageThreadId}` : base;
};

export const encodeGuestInlineMessageId = (inlineMessageId: string): string =>
  `${TELEGRAM_GUEST_INLINE_ID_PREFIX}${inlineMessageId}`;

export const decodeGuestInlineMessageId = (messageId: string): string | undefined => {
  if (!messageId.startsWith(TELEGRAM_GUEST_INLINE_ID_PREFIX)) return undefined;
  const id = messageId.slice(TELEGRAM_GUEST_INLINE_ID_PREFIX.length);
  return id.length > 0 ? id : undefined;
};

export const parseTelegramThreadId = (threadId: string): ParsedTelegramThreadId => {
  const parts = threadId.split(':');
  if (parts[0] !== PLATFORM || parts.length < 2) {
    return { chatId: threadId, guest: false };
  }

  if (parts[1] === GUEST_SEGMENT) {
    const chatId = parts[2];
    if (!chatId) return { chatId: threadId, guest: true };

    const asGuest = (
      extra: Omit<ParsedTelegramThreadId, 'chatId' | 'guest'> = {},
    ): ParsedTelegramThreadId => ({ chatId, guest: true, ...extra });

    if (parts[3] === 'bot' && parts[4] && parts[5] === 'message' && parts[6]) {
      return asGuest({
        guestBotId: parts[4],
        guestMessageId: parts[6],
        messageThreadId: parseOptionalThreadId(parts[7]),
      });
    }

    // Backward compatibility for callbacks created before guest thread IDs
    // included the bot application ID.
    if (parts[3] === 'message' && parts[4]) {
      return asGuest({
        guestMessageId: parts[4],
        messageThreadId: parseOptionalThreadId(parts[5]),
      });
    }

    // Backward compatibility for callbacks created before guest invocations
    // gained a message-scoped thread id.
    return asGuest({ messageThreadId: parseOptionalThreadId(parts[3]) });
  }

  return {
    chatId: parts[1]!,
    guest: false,
    messageThreadId: parseOptionalThreadId(parts[2]),
  };
};

const parseOptionalThreadId = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const getTelegramGuestQueryId = (message?: { raw?: unknown }): string | undefined => {
  if (!message?.raw || typeof message.raw !== 'object') return undefined;
  const id = (message.raw as { guest_query_id?: unknown }).guest_query_id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
};

/**
 * Telegram `language_code` of the user who summoned the bot in Guest Mode -
 * `guest_bot_caller_user` when present, otherwise the message sender. Used to
 * localize Guest Mode link prompts in the summoner's language.
 */
export const getTelegramGuestAuthorLanguageCode = (message?: {
  raw?: unknown;
}): string | undefined => {
  if (!message?.raw || typeof message.raw !== 'object') return undefined;
  const raw = message.raw as {
    from?: { language_code?: unknown };
    guest_bot_caller_user?: { language_code?: unknown };
  };
  const code = raw.guest_bot_caller_user?.language_code ?? raw.from?.language_code;
  return typeof code === 'string' && code.length > 0 ? code : undefined;
};
