import { formatSpeakerMessage } from '@lobechat/prompts';

interface RawReferencedMessage {
  author?: { global_name?: string; username?: string };
  content?: string;
}

interface MessageLike {
  author: { fullName?: string; userId: string; userName?: string };
  raw?: {
    author?: { avatar?: string | null; global_name?: string | null };
    referenced_message?: RawReferencedMessage;
  };
  text: string;
}

interface BotContext {
  applicationId?: string;
}

/**
 * Extract referenced (replied-to) message from Discord raw payload
 * and format it as an XML tag for the agent prompt.
 */
export const formatReferencedMessage = (
  raw: { referenced_message?: RawReferencedMessage } | undefined,
): string | undefined => {
  const ref = raw?.referenced_message;
  if (!ref?.content) return undefined;

  const sender = ref.author?.global_name || ref.author?.username || 'unknown';

  return `<referenced_message sender="${sender}">${ref.content}</referenced_message>`;
};

/**
 * Format user message into agent prompt:
 * 1. Strip bot's own @mention (Discord format: <@botId>)
 * 2. Prepend referenced (quoted/replied) message if present
 * 3. Add speaker tag with user identity
 */
export const formatPrompt = (message: MessageLike, botContext?: BotContext): string => {
  let text = message.text;

  if (botContext?.applicationId) {
    text = text.replaceAll(new RegExp(`<@!?${botContext.applicationId}>\\s*`, 'g'), '').trim();
  }

  // Prepend referenced (quoted/replied) message if present
  const referencedText = formatReferencedMessage(message.raw);
  if (referencedText) {
    text = `${referencedText}\n${text}`;
  }

  const { userId, userName, fullName } = message.author;
  const raw = message.raw?.author;
  const avatar = raw?.avatar ?? '';
  const globalName = raw?.global_name ?? fullName;

  return formatSpeakerMessage(
    { avatar, id: userId, nickname: globalName, username: userName },
    text,
  );
};
