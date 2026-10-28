import type { FieldSchema } from './types';

/** Longest reply style handed to the agent; longer text is cut, not rejected. */
export const MAX_REPLY_STYLE_LENGTH = 2000;
/** Most channels with a style of their own. */
export const MAX_CHANNEL_REPLY_STYLES = 200;
/** Most emoji the agent is offered; a longer list is cut in authoring order. */
export const MAX_REPLY_EMOJIS = 50;

const REPLY_STYLE_ROWS = 6;

/**
 * An emoji or sticker the owner lets the bot use in its replies: `emoji` is pasted into the text as
 * it is (a Unicode emoji, a Discord custom emoji `<:doge:123>`, a Slack `:doge:`), `usage` says when
 * it fits.
 */
export interface ReplyEmojiEntry {
  emoji: string;
  usage?: string;
}

/**
 * How the bot talks, as the owner wrote it: a default for every channel, a style per channel that
 * replaces it there, and the emoji it may use. Only how it speaks: what it does belongs to the
 * duties, and whether it speaks to bot-wake.
 */
export const replyStyleFields: FieldSchema[] = [
  {
    key: 'replyStyle',
    description: 'channel.replyStyleHint',
    label: 'channel.replyStyle',
    maximum: MAX_REPLY_STYLE_LENGTH,
    placeholder: 'channel.replyStylePlaceholder',
    rows: REPLY_STYLE_ROWS,
    type: 'string',
  },
  {
    key: 'channelReplyStyles',
    default: [],
    description: 'channel.channelReplyStylesHint',
    items: {
      key: 'item',
      label: '',
      properties: [
        {
          key: 'channelId',
          label: 'channel.channelReplyStyleChannelLabel',
          placeholder: 'channel.channelReplyStyleChannelPlaceholder',
          required: true,
          type: 'string',
        },
        {
          key: 'style',
          label: 'channel.channelReplyStyleStyleLabel',
          placeholder: 'channel.replyStylePlaceholder',
          required: true,
          type: 'string',
        },
      ],
      type: 'object',
    },
    label: 'channel.channelReplyStyles',
    maximum: MAX_CHANNEL_REPLY_STYLES,
    type: 'array',
  },
  {
    key: 'replyEmojis',
    default: [],
    description: 'channel.replyEmojisHint',
    items: {
      key: 'item',
      label: '',
      properties: [
        {
          key: 'emoji',
          label: 'channel.replyEmojiLabel',
          placeholder: 'channel.replyEmojiPlaceholder',
          required: true,
          type: 'string',
        },
        {
          key: 'usage',
          label: 'channel.replyEmojiUsageLabel',
          placeholder: 'channel.replyEmojiUsagePlaceholder',
          type: 'string',
        },
      ],
      type: 'object',
    },
    label: 'channel.replyEmojis',
    maximum: MAX_REPLY_EMOJIS,
    type: 'array',
  },
];

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/**
 * The reply style for one conversation: the style written for its channel or thread when there is
 * one, otherwise the bot's default.
 *
 * Expects:
 * - `channelIds` from the outermost to the innermost (a Discord channel, then its thread), as
 *   `resolveChannelKeys` lists them; the innermost match wins
 *
 * Returns:
 * - The trimmed style, cut to {@link MAX_REPLY_STYLE_LENGTH}; `undefined` when none applies
 */
export const resolveReplyStyle = (
  settings: Record<string, unknown> | null | undefined,
  channelIds: readonly string[],
): string | undefined => {
  const overrides = Array.isArray(settings?.channelReplyStyles) ? settings.channelReplyStyles : [];
  const byChannel = new Map<string, string>();
  for (const entry of overrides) {
    if (!entry || typeof entry !== 'object') continue;
    const channelId = text((entry as Record<string, unknown>).channelId);
    const style = text((entry as Record<string, unknown>).style);
    if (channelId && style && !byChannel.has(channelId)) byChannel.set(channelId, style);
  }

  const forChannel = [...channelIds].reverse().find((id) => byChannel.has(id));
  const style = forChannel ? byChannel.get(forChannel) : text(settings?.replyStyle);

  return style ? style.slice(0, MAX_REPLY_STYLE_LENGTH) : undefined;
};

/**
 * The emoji the owner lets the bot use, deduplicated by emoji in authoring order (the first
 * non-empty usage wins), at most {@link MAX_REPLY_EMOJIS}.
 */
export const extractReplyEmojis = (
  settings: Record<string, unknown> | null | undefined,
): ReplyEmojiEntry[] => {
  const raw = Array.isArray(settings?.replyEmojis) ? settings.replyEmojis : [];
  const byEmoji = new Map<string, ReplyEmojiEntry>();
  for (const entry of raw) {
    const fields = typeof entry === 'string' ? { emoji: entry } : entry;
    if (!fields || typeof fields !== 'object') continue;
    const emoji = text((fields as Record<string, unknown>).emoji);
    if (!emoji) continue;
    const usage = text((fields as Record<string, unknown>).usage) || undefined;
    const existing = byEmoji.get(emoji);
    if (existing) {
      existing.usage ??= usage;
      continue;
    }
    byEmoji.set(emoji, { emoji, ...(usage && { usage }) });
  }

  return [...byEmoji.values()].slice(0, MAX_REPLY_EMOJIS);
};
