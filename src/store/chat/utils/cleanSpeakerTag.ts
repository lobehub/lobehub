/**
 * Regex to match speaker tag at the beginning of content
 *
 * Two formats exist:
 * 1. Group chat: <speaker name="Agent Name" />
 * 2. IM bot:     <speaker id="..." username="..." nickname="..." />
 *
 * These tags are injected to identify message senders. Models may accidentally
 * reproduce them in output, and they should be stripped for UI display.
 */
const SPEAKER_TAG_REGEX = /^<speaker\s+\S[^>]*\/>\n?/;

/**
 * Remove speaker tag from the beginning of assistant message content.
 *
 * In group chat scenarios, we inject `<speaker name="..." />` at the beginning
 * of assistant messages to help the model identify who sent each message.
 * However, models may accidentally reproduce this tag in their output.
 * This function removes any such tag from the content.
 *
 * @param content - The message content to clean
 * @returns Content with speaker tag removed (if present)
 *
 * @example
 * ```typescript
 * cleanSpeakerTag('<speaker name="Weather Expert" />\nHello!')
 * // Returns: 'Hello!'
 *
 * cleanSpeakerTag('Hello!')
 * // Returns: 'Hello!'
 * ```
 */
export const cleanSpeakerTag = (content: string): string => {
  return content.replace(SPEAKER_TAG_REGEX, '');
};
