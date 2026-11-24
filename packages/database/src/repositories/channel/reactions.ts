import type { ChannelMessageReaction } from '@lobechat/types';
import { channelMessageDeletedAt } from '@lobechat/types';
import { and, asc, count, desc, eq, gte, inArray, max, sql } from 'drizzle-orm';

import { channelMembers, channelMessageReactions, channelMessages } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { ChannelError } from './error';

/** Distinct emoji one member may leave on one message. */
export const CHANNEL_REACTIONS_PER_MEMBER = 20;
/** How far back a person's own reactions count toward their quick reactions. */
export const FREQUENT_REACTION_DAYS = 90;
export const FREQUENT_REACTION_LIMIT = 5;

// One emoji, as a picker inserts it: pictographs with their modifiers, joiners and variation
// selectors, a flag, or a keycap. Custom emoji (`emj_…`) are not accepted until they can be made.
// Emoji_Component covers the joiner, variation selector, keycap mark, skin tones and flags' parts.
const EMOJI_PART = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component})$/u;
const EMOJI_BASE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const KEYCAP = String.fromCharCode(0x20_e3);
const MAX_EMOJI_LENGTH = 32;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export const normalizeReactionEmoji = (emoji: string) => {
  const value = emoji.trim();
  if (
    !value ||
    value.length > MAX_EMOJI_LENGTH ||
    !(EMOJI_BASE.test(value) || value.endsWith(KEYCAP)) ||
    [...value].some((char) => !EMOJI_PART.test(char)) ||
    [...graphemes.segment(value)].length !== 1
  )
    throw new ChannelError('BAD_REQUEST', 'A reaction is a single emoji');
  return value;
};

/** Every message's reactions, each emoji in the order it was first left on that message. */
export const reactionsByMessage = async (
  tx: Transaction | LobeChatDatabase,
  channelId: string,
  messageIds: string[],
): Promise<Map<string, ChannelMessageReaction[]>> => {
  const result = new Map<string, ChannelMessageReaction[]>();
  if (!messageIds.length) return result;
  const rows = await tx
    .select({
      emoji: channelMessageReactions.emoji,
      memberId: channelMessageReactions.memberId,
      messageId: channelMessageReactions.messageId,
    })
    .from(channelMessageReactions)
    .where(
      and(
        eq(channelMessageReactions.channelId, channelId),
        inArray(channelMessageReactions.messageId, [...new Set(messageIds)]),
      ),
    )
    .orderBy(asc(channelMessageReactions.createdAt), asc(channelMessageReactions.id));
  for (const row of rows) {
    const reactions = result.get(row.messageId) ?? [];
    const entry = reactions.find((reaction) => reaction.emoji === row.emoji);
    if (entry) {
      entry.count += 1;
      entry.memberIds.push(row.memberId);
    } else reactions.push({ count: 1, emoji: row.emoji, memberIds: [row.memberId] });
    result.set(row.messageId, reactions);
  }
  return result;
};

/**
 * Adds or removes one member's reaction on a message of its Channel. A reaction is not a message:
 * it posts nothing, routes to nobody and leaves read state alone. `desired` pins the outcome so a
 * retried call does not undo itself; without it the reaction flips.
 */
export const setReaction = async (
  tx: Transaction,
  channelId: string,
  memberId: string,
  messageId: string,
  emoji: string,
  desired?: boolean,
): Promise<{ added: boolean; reactions: ChannelMessageReaction[] }> => {
  const value = normalizeReactionEmoji(emoji);
  const [message] = await tx
    .select({ metadata: channelMessages.metadata })
    .from(channelMessages)
    .where(and(eq(channelMessages.channelId, channelId), eq(channelMessages.id, messageId)));
  if (!message) throw new ChannelError('NOT_FOUND', 'Message not found');

  const mine = and(
    eq(channelMessageReactions.messageId, messageId),
    eq(channelMessageReactions.memberId, memberId),
  );
  const [existing] = await tx
    .select({ id: channelMessageReactions.id })
    .from(channelMessageReactions)
    .where(and(mine, eq(channelMessageReactions.emoji, value)));
  const add = desired ?? !existing;

  if (add && !existing) {
    if (channelMessageDeletedAt(message.metadata))
      throw new ChannelError('CONFLICT', 'A deleted message cannot be reacted to');
    const [{ total }] = await tx
      .select({ total: count() })
      .from(channelMessageReactions)
      .where(mine);
    if (total >= CHANNEL_REACTIONS_PER_MEMBER)
      throw new ChannelError('BAD_REQUEST', 'Too many reactions on this message');
    await tx
      .insert(channelMessageReactions)
      .values({ channelId, emoji: value, memberId, messageId })
      .onConflictDoNothing();
  } else if (!add && existing) {
    await tx.delete(channelMessageReactions).where(eq(channelMessageReactions.id, existing.id));
  }

  const reactions = await reactionsByMessage(tx, channelId, [messageId]);
  return { added: add, reactions: reactions.get(messageId) ?? [] };
};

/**
 * The emoji a person reacted with most in the last 90 days, in every Channel and scope, the most
 * used first and, between equals, the most recent. Their Agents' reactions are not theirs.
 */
export const frequentReactions = async (
  db: Transaction | LobeChatDatabase,
  userId: string,
  limit = FREQUENT_REACTION_LIMIT,
): Promise<string[]> => {
  const since = new Date(Date.now() - FREQUENT_REACTION_DAYS * 24 * 60 * 60 * 1000);
  const uses = count();
  const lastUsed = max(channelMessageReactions.createdAt);
  const rows = await db
    .select({ emoji: channelMessageReactions.emoji })
    .from(channelMessageReactions)
    .innerJoin(
      channelMembers,
      and(
        eq(channelMembers.channelId, channelMessageReactions.channelId),
        eq(channelMembers.id, channelMessageReactions.memberId),
      ),
    )
    .where(
      and(
        eq(channelMembers.userId, userId),
        eq(channelMembers.actorType, 'user'),
        gte(channelMessageReactions.createdAt, since),
      ),
    )
    .groupBy(channelMessageReactions.emoji)
    .orderBy(desc(uses), desc(lastUsed), sql`${channelMessageReactions.emoji}`)
    .limit(limit);
  return rows.map((row) => row.emoji);
};
