import { formatSpeakerMessage } from '@lobechat/prompts';
import type { BotSenderMetadata } from '@lobechat/types';

interface RawReferencedMessage {
  author?: { global_name?: string; username?: string };
  content?: string;
}

interface TelegramReplyToMessage {
  caption?: string;
  from?: { first_name?: string; username?: string };
  text?: string;
}

interface ReferencedRaw {
  quote?: { text?: string };
  referenced_message?: RawReferencedMessage;
  reply_to_message?: TelegramReplyToMessage;
}

interface MessageLike {
  author: { fullName?: string; userId: string; userName?: string };
  raw?: {
    author?: { avatar?: string | null; global_name?: string | null };
  } & ReferencedRaw;
  text: string;
}

interface FormatPromptOptions {
  /** Strip platform-specific bot mention artifacts from user input. */
  sanitizeUserInput?: (text: string) => string;
}

const wrapReferencedMessage = (sender: string, content: string): string =>
  `<referenced_message sender="${sender}">${content}</referenced_message>`;

/**
 * Extract referenced (replied-to) message from raw payload
 * and format it as an XML tag for the agent prompt.
 */
export const formatReferencedMessage = (raw: ReferencedRaw | undefined): string | undefined => {
  const discordRef = raw?.referenced_message;
  if (discordRef?.content) {
    const sender = discordRef.author?.global_name || discordRef.author?.username || 'unknown';
    return wrapReferencedMessage(sender, discordRef.content);
  }

  const telegramRef = raw?.reply_to_message;
  const telegramContent = telegramRef?.text || telegramRef?.caption;
  const selectedQuote = raw?.quote?.text;
  if (!telegramContent && !selectedQuote) return undefined;
  const sender = telegramRef?.from?.first_name || telegramRef?.from?.username || 'unknown';

  if (!telegramContent) {
    return wrapReferencedMessage(sender, `<selected_quote>${selectedQuote}</selected_quote>`);
  }

  if (selectedQuote) {
    return wrapReferencedMessage(
      sender,
      `<full_message>${telegramContent}</full_message>\n<selected_quote>${selectedQuote}</selected_quote>`,
    );
  }

  return wrapReferencedMessage(sender, telegramContent);
};

/**
 * Format user message into agent prompt:
 * 1. Strip platform-specific bot mentions via sanitizeUserInput
 * 2. Prepend referenced (quoted/replied) message if present
 * 3. Add speaker tag with user identity
 */
export const formatPrompt = (message: MessageLike, options?: FormatPromptOptions): string => {
  let text = message.text;

  if (options?.sanitizeUserInput) {
    text = options.sanitizeUserInput(text);
  }

  // Prepend referenced (quoted/replied) message if present
  const referencedText = formatReferencedMessage(message.raw);
  if (referencedText) {
    text = `${referencedText}\n${text}`;
  }

  const { avatar, id, nickname, username } = resolveSpeaker(message);

  return formatSpeakerMessage({ avatar, id, nickname, username }, text);
};

/**
 * Single source of the author identity used by both the `<speaker>` prompt tag
 * and the persisted `metadata.botSender`, so the model and the UI never see
 * two different names for the same person.
 */
const resolveSpeaker = (message: Pick<MessageLike, 'author' | 'raw'>) => {
  const { userId, userName, fullName } = message.author;
  const raw = message.raw?.author;
  return {
    avatar: raw?.avatar ?? '',
    id: userId,
    nickname: raw?.global_name ?? fullName,
    username: userName,
  };
};

const DISCORD_CDN = 'https://cdn.discordapp.com';

/**
 * Turn whatever the platform handed us into an absolute avatar URL. Discord
 * only exposes an avatar *hash* on `raw.author`, which is meaningless to an
 * `<img>` until combined with the user id.
 */
export const resolveBotSenderAvatar = (
  avatar: string | undefined,
  platform: string,
  userId: string,
): string | undefined => {
  if (!avatar) return undefined;
  if (/^https?:\/\//.test(avatar)) return avatar;
  if (platform === 'discord') {
    const ext = avatar.startsWith('a_') ? 'gif' : 'png';
    return `${DISCORD_CDN}/avatars/${userId}/${avatar}.${ext}`;
  }
  return undefined;
};

/**
 * Build the structured sender block stored on the inbound user message so the
 * workspace UI can show the real platform author instead of the bot owner.
 */
export const buildBotSender = (
  message: Pick<MessageLike, 'author' | 'raw'>,
  platform: string,
): BotSenderMetadata => {
  const { avatar, id, nickname, username } = resolveSpeaker(message);
  return {
    avatar: resolveBotSenderAvatar(avatar, platform, id),
    fullName: nickname || undefined,
    id,
    platform,
    // Feishu/Lark fills both fields with the display name — drop the duplicate.
    username: username && username !== nickname ? username : undefined,
  };
};
