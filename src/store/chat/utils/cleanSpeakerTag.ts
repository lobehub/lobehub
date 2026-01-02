/**
 * Regex to match speaker tag at the beginning of content
 * Format: <speaker name="Agent Name" />
 *
 * This tag is injected by GroupMessageSenderProcessor to identify message senders
 * in group chat scenarios. Models may accidentally reproduce this tag in their output,
 * so we need to filter it out during streaming.
 */
const SPEAKER_TAG_REGEX = /^<speaker\s+name="[^"]*"\s*\/>\n?/;

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
