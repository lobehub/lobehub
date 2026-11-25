import type { ChannelMessageReaction } from '@lobechat/types';
import { channelMessageDeletedAt } from '@lobechat/types';
import { and, count, desc, eq, gte, inArray, max, sql } from 'drizzle-orm';

import type { ChannelJobItem } from '../../schemas';
import { channelMembers, channelMessageReactions, channelMessages } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { ChannelError } from './error';

/** Distinct emoji one member may leave on one message. */
export const CHANNEL_REACTIONS_PER_MEMBER = 20;
/** Distinct emoji one message may carry, which bounds how many groups a page reads. */
export const CHANNEL_REACTION_EMOJI_PER_MESSAGE = 50;
/** Members named per emoji in a view; `count` stays exact. */
export const REACTION_MEMBER_PREVIEW = 20;
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

/**
 * Every message's reactions, each emoji in the order it was first left on that message. Counts
 * are aggregated in SQL and each emoji names at most its first `REACTION_MEMBER_PREVIEW` members,
 * plus the viewer's own member when it reacted later, so a page of a large Channel stays small.
 */
export const reactionsByMessage = async (
  tx: Transaction | LobeChatDatabase,
  channelId: string,
  messageIds: string[],
  viewerMemberId?: string | null,
): Promise<Map<string, ChannelMessageReaction[]>> => {
  const result = new Map<string, ChannelMessageReaction[]>();
  if (!messageIds.length) return result;
  const r = channelMessageReactions;
  const scope = and(eq(r.channelId, channelId), inArray(r.messageId, [...new Set(messageIds)]));
  const [groups, own] = await Promise.all([
    tx
      .select({
        count: sql<number>`count(*)::int`,
        emoji: r.emoji,
        memberIds: sql<
          string[]
        >`(array_agg(${r.memberId}::text order by ${r.createdAt}, ${r.id}))[1:${sql.raw(String(REACTION_MEMBER_PREVIEW))}]`,
        messageId: r.messageId,
      })
      .from(r)
      .where(scope)
      .groupBy(r.messageId, r.emoji)
      .orderBy(sql`min(${r.createdAt})`, sql`min(${r.id}::text)`),
    viewerMemberId
      ? tx
          .select({ emoji: r.emoji, messageId: r.messageId })
          .from(r)
          .where(and(scope, eq(r.memberId, viewerMemberId)))
      : Promise.resolve([]),
  ]);
  const mine = new Set(own.map((row) => `${row.messageId} ${row.emoji}`));
  for (const group of groups) {
    const memberIds = group.memberIds ?? [];
    if (
      viewerMemberId &&
      mine.has(`${group.messageId} ${group.emoji}`) &&
      !memberIds.includes(viewerMemberId)
    )
      memberIds.push(viewerMemberId);
    const reactions = result.get(group.messageId) ?? [];
    reactions.push({ count: Number(group.count), emoji: group.emoji, memberIds });
    result.set(group.messageId, reactions);
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
    const [taken] = await tx
      .select({ id: channelMessageReactions.id })
      .from(channelMessageReactions)
      .where(
        and(
          eq(channelMessageReactions.messageId, messageId),
          eq(channelMessageReactions.emoji, value),
        ),
      )
      .limit(1);
    if (!taken) {
      const [{ emojis }] = await tx
        .select({ emojis: sql<number>`count(distinct ${channelMessageReactions.emoji})::int` })
        .from(channelMessageReactions)
        .where(eq(channelMessageReactions.messageId, messageId));
      if (Number(emojis) >= CHANNEL_REACTION_EMOJI_PER_MESSAGE)
        throw new ChannelError('BAD_REQUEST', 'This message has too many different reactions');
    }
    await tx
      .insert(channelMessageReactions)
      .values({ channelId, emoji: value, memberId, messageId })
      .onConflictDoNothing();
  } else if (!add && existing) {
    await tx.delete(channelMessageReactions).where(eq(channelMessageReactions.id, existing.id));
  }

  const reactions = await reactionsByMessage(tx, channelId, [messageId], memberId);
  return { added: add, reactions: reactions.get(messageId) ?? [] };
};

/** What an Agent shows on a request while it works on it. */
export const CHANNEL_JOB_WORKING_REACTION = '👀';
/** What replaces it once the Agent's reply is out. */
export const CHANNEL_JOB_ANSWERED_REACTION = '✅';

/**
 * The mark an Agent leaves on the request it was asked to answer, the way a teammate would:
 * 👀 while it works (`working`), ✅ once its reply is out (`answered`), and nothing when the job
 * ended without one (`cleared`). Only a job that owes an answer marks its request: a `followup`
 * wake may stay silent, and a 👀 that comes and goes would only say it looked.
 *
 * Best effort, in a savepoint: a reaction the message refuses (deleted, too many) never undoes
 * the job's own write. Returns whether the reactions changed as asked.
 */
export const markJobRequest = async (
  tx: Transaction,
  job: Pick<ChannelJobItem, 'channelId' | 'memberId' | 'messageId' | 'wake'>,
  state: 'answered' | 'cleared' | 'working',
): Promise<boolean> => {
  if (job.wake?.kind === 'followup') return false;
  try {
    await tx.transaction(async (savepoint) => {
      const mark = (emoji: string, add: boolean) =>
        setReaction(savepoint, job.channelId, job.memberId, job.messageId, emoji, add);
      await mark(CHANNEL_JOB_WORKING_REACTION, state === 'working');
      if (state === 'answered') await mark(CHANNEL_JOB_ANSWERED_REACTION, true);
    });
    return true;
  } catch {
    return false;
  }
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
