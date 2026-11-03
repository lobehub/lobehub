export interface SpeakerInfo {
  avatar?: string;
  id: string;
  nickname?: string;
  username?: string;
}

/**
 * Format a speaker XML tag to prepend to a user message.
 * Used in IM bot scenarios (Discord, Slack, etc.) to identify the message author.
 *
 * @example
 * ```typescript
 * const tag = formatSpeakerTag({
 *   id: '123456',
 *   username: 'john',
 *   nickname: 'John Doe',
 *   avatar: 'abc123',
 * });
 * // Returns: '<speaker id="123456" username="john" nickname="John Doe" avatar="abc123" />'
 * ```
 */
export const formatSpeakerTag = (speaker: SpeakerInfo): string => {
  const attrs = [`id="${speaker.id}"`];

  if (speaker.username) attrs.push(`username="${speaker.username}"`);
  if (speaker.nickname) attrs.push(`nickname="${speaker.nickname}"`);
  if (speaker.avatar) attrs.push(`avatar="${speaker.avatar}"`);

  return `<speaker ${attrs.join(' ')} />`;
};

/**
 * Format a user message with a speaker tag prepended.
 *
 * @example
 * ```typescript
 * const prompt = formatSpeakerMessage(
 *   { id: '123456', username: 'john', nickname: 'John Doe' },
 *   'Hello, how are you?',
 * );
 * // Returns:
 * // '<speaker id="123456" username="john" nickname="John Doe" />\nHello, how are you?'
 * ```
 */
export const formatSpeakerMessage = (speaker: SpeakerInfo, text: string): string => {
  return `${formatSpeakerTag(speaker)}\n${text}`;
};
