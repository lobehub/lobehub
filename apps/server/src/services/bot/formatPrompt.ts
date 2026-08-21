import { formatSpeakerMessage, type RecentGroupMessage } from '@lobechat/prompts';

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

interface FormatPromptOptions {
  /** Strip platform-specific bot mention artifacts from user input. */
  sanitizeUserInput?: (text: string) => string;
}

/**
 * Extract referenced (replied-to) message from raw payload
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
 * Group history pre-inject block (Feishu-style watermark platforms): human
 * messages the bot missed since its last injection. Prepended to the user
 * prompt — NOT the system prompt — so it persists as the topic's user message
 * and stays visible on every later turn (rebuilding it in the system prompt
 * each turn silently dropped earlier injections).
 */
export const formatGroupHistoryBlock = (messages: RecentGroupMessage[]): string => {
  const lines = messages.filter((m) => m?.author && m?.text).map((m) => `${m.author}: ${m.text}`);
  if (lines.length === 0) return '';

  return [
    '<recent_group_messages>',
    'Messages from this group thread since your last interaction (oldest first), possibly with some overlap with earlier turns — treat repeated messages as the same content, not new information. They include messages sent without @-mentioning you; use them as surrounding discussion context. The LAST user message is the one you are answering.',
    'Messages are prefixed with the speaker name. Data queries must use the identity of the user who @-mentioned you, not other speakers.',
    ...lines,
    '</recent_group_messages>',
  ].join('\n');
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

  const { userId, userName, fullName } = message.author;
  const raw = message.raw?.author;
  const avatar = raw?.avatar ?? '';
  const globalName = raw?.global_name ?? fullName;

  return formatSpeakerMessage(
    { avatar, id: userId, nickname: globalName, username: userName },
    text,
  );
};
