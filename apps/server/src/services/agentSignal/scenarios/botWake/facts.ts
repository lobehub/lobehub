import type { WakeChannelKeys, WakeMentions } from './types';

const DISCORD_USER_MENTION = /<@!?(\d+)>/g;
const DISCORD_ROLE_MENTION = /<@&(\d+)>/g;
const DISCORD_CUSTOM_EMOJI = /<a?:\w+:\d+>/g;
const SHORTCODE_EMOJI = /:[\w+-]+:/g;

/**
 * Re-derives mentions from a Discord message's own text.
 *
 * The chat SDK adapter folds `@everyone`, `@here` and configured role pings into `isMention`
 * (`respondToGlobalMentions`, `mentionRoleIds`), so that flag cannot tell an @bot from a
 * broadcast. The gateway path also hands over `raw` with only `content`, so the text is the one
 * source both paths share.
 *
 * Expects:
 * - `botUserId` is the id Discord renders the bot as in `<@id>` (the application id)
 */
export const parseDiscordMentions = (text: string, botUserId: string): WakeMentions => {
  const userIds = [...text.matchAll(DISCORD_USER_MENTION)].map((match) => match[1]);
  const roleIds = [...text.matchAll(DISCORD_ROLE_MENTION)].map((match) => match[1]);

  return {
    botMentioned: userIds.includes(botUserId),
    everyone: /(?<!\S)@everyone\b/.test(text),
    here: /(?<!\S)@here\b/.test(text),
    otherUserIds: [...new Set(userIds.filter((id) => id !== botUserId))],
    roleIds: [...new Set(roleIds)],
  };
};

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

/**
 * File keys for a conversation's wake state.
 *
 * Discord opens a thread under a mention and the bot speaks there, so state is kept under the
 * parent channel *and* the thread; a later message in either finds the bot's last post. Other
 * platforms have one conversation id.
 */
export const resolveChannelKeys = (
  platform: string,
  applicationId: string,
  platformThreadId: string,
): WakeChannelKeys => {
  const base = `${platform}:${applicationId}`;

  if (platform === 'discord') {
    const [, guildId, channelId, threadId] = platformThreadId.split(':');

    if (guildId && channelId) {
      return {
        channelKey: `${base}:${guildId}:${channelId}`,
        ids: [channelId, ...(threadId ? [threadId] : [])],
        // `threadKey` is the channel key plus the thread id: a thread belongs to one channel.
        ...(threadId ? { threadKey: `${base}:${guildId}:${channelId}:${threadId}` } : {}),
      };
    }
  }

  // Other platforms encode the conversation as `platform:part:part`. The owner may know it by the
  // whole id or by the id they see in the platform's UI (Telegram chat id, Slack channel id).
  const [, ...parts] = platformThreadId.split(':');

  return {
    channelKey: `${base}:${platformThreadId}`,
    ids: [platformThreadId, ...parts.filter(Boolean)],
  };
};

/**
 * Keys of a conversation's shared message log, the channel first and then the thread when there is
 * one. Unlike the wake state they carry no application id: every bot in a channel reads and writes
 * the same log, so the channel's last messages are stored once however many bots listen.
 *
 * A person's message is filed under the last key only (where it was said); the bot's own reply is
 * filed under all of them, because people answer it from the channel as well as from the thread.
 */
export const resolveConversationLogKeys = (
  platform: string,
  platformThreadId: string,
): string[] => {
  if (platform === 'discord') {
    const [, guildId, channelId, threadId] = platformThreadId.split(':');

    if (guildId && channelId) {
      const channel = ['discord', guildId, channelId].join(':');

      return threadId ? [channel, `${channel}:${threadId}`] : [channel];
    }
  }

  return [`${platform}:${platformThreadId.split(':').slice(1).join(':')}`];
};

/** Where a message said in this conversation is filed: the most specific log. */
export const resolveConversationLogKey = (platform: string, platformThreadId: string): string =>
  resolveConversationLogKeys(platform, platformThreadId).at(-1)!;

/** Every key the channel's state is written under (channel first, then thread when there is one). */
export const wakeStateKeys = (keys: WakeChannelKeys): string[] =>
  keys.threadKey ? [keys.channelKey, keys.threadKey] : [keys.channelKey];
