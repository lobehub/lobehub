import type { WakeChannelKeys, WakeMentions } from './types';

const DISCORD_CUSTOM_EMOJI = /<a?:\w+:\d+>/g;
const SHORTCODE_EMOJI = /:[\w+-]+:/g;

/**
 * Whether the platform's "mentioned" flag survives the re-judgement.
 *
 * Returns:
 * - the flag unchanged when mentions could not be re-derived (non-Discord platforms)
 * - otherwise `true` only when the bot itself is @-mentioned. `@everyone`, `@here` and a role
 *   ping the adapter counted as a mention do not wake the bot on the explicit path.
 */
export const judgeExplicitMention = (
  adapterIsMention: boolean,
  mentions: WakeMentions | undefined,
): boolean => (mentions ? mentions.botMentioned : adapterIsMention);

/**
 * True for a message with nothing to answer: blank, punctuation, or only emoji. A message
 * carrying an attachment is never empty.
 */
export const isEmptyOrEmojiOnly = (text: string, hasAttachments = false): boolean => {
  if (hasAttachments) return false;

  const stripped = text
    .replaceAll(DISCORD_CUSTOM_EMOJI, '')
    .replaceAll(SHORTCODE_EMOJI, '')
    .replaceAll(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}]/gu, '')
    // Marks cover the variation selector and the keycap; format characters cover the ZWJ.
    .replaceAll(/[\p{M}\p{P}\p{S}\p{Z}\p{C}]/gu, '');

  return stripped.length === 0;
};

/** Every key the channel's state is written under (channel first, then thread when there is one). */
export const wakeStateKeys = (keys: WakeChannelKeys): string[] =>
  keys.threadKey ? [keys.channelKey, keys.threadKey] : [keys.channelKey];
