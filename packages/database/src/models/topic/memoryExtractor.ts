import { and, count, eq, gt, gte, lte, ne, or, sql } from 'drizzle-orm';

import { topics } from '../../schemas';
import { notEvalTopic } from '../../utils/evalTopic';
import { notChannelTopic } from '../../utils/topicVisibility';
import type { TopicModelContext } from './context';
import type { ListTopicsForMemoryExtractorCursor } from './types';

export const listTopicsForMemoryExtractor = async (
  ctx: TopicModelContext,
  options: {
    cursor?: ListTopicsForMemoryExtractorCursor;
    endDate?: Date;
    ignoreExtracted?: boolean;
    limit?: number;
    startDate?: Date;
  } = {},
) => {
  const cursorCondition = options.cursor
    ? and(
        ne(topics.id, options.cursor.id),
        or(
          gt(topics.createdAt, options.cursor.createdAt),
          and(eq(topics.createdAt, options.cursor.createdAt), gt(topics.id, options.cursor.id)),
        ),
      )
    : undefined;

  return ctx.db.query.topics.findMany({
    columns: {
      createdAt: true,
      id: true,
      metadata: true,
      userId: true,
    },
    limit: options.limit,
    orderBy: (fields, { asc }) => [asc(fields.createdAt), asc(fields.id)],
    where: and(
      ctx.ownership(),
      // Share-visitor conversations are not the creator's own speech — never
      // feed them into the creator's memory extraction. Channel runs carry
      // other members' Channel content, which stays inside the Channel.
      ctx.notShareVisitor(),
      notChannelTopic(),
      // Eval dialogue is a test script, not the user's own speech.
      notEvalTopic(),
      options.startDate ? gte(topics.createdAt, options.startDate) : undefined,
      options.endDate ? lte(topics.createdAt, options.endDate) : undefined,
      options.ignoreExtracted
        ? undefined
        : // COALESCE, not `IS DISTINCT FROM`: a null test on a jsonb arrow
          // expression crashes the production engine (see the note on the class).
          // A null `metadata` extracts to '' here too, so this covers it.
          sql`COALESCE(${topics.metadata}->>'userMemoryExtractStatus', '') <> 'completed'`,
      cursorCondition,
    ),
  });
};

export const countTopicsForMemoryExtractor = async (
  ctx: TopicModelContext,
  options: {
    endDate?: Date;
    ignoreExtracted?: boolean;
    startDate?: Date;
  } = {},
) => {
  const result = await ctx.db
    .select({ total: count(topics.id) })
    .from(topics)
    .where(
      and(
        ctx.ownership(),
        ctx.notShareVisitor(),
        notChannelTopic(),
        notEvalTopic(),
        options.startDate ? gte(topics.createdAt, options.startDate) : undefined,
        options.endDate ? lte(topics.createdAt, options.endDate) : undefined,
        options.ignoreExtracted
          ? undefined
          : sql`COALESCE(${topics.metadata}->>'userMemoryExtractStatus', '') <> 'completed'`,
      ),
    );

  return result[0]?.total ?? 0;
};

/**
 * Resets the memory-extraction state of all the caller's topics back to
 * `pending`, clearing any previous run summary. Used by "purge all
 * memories": after memories are deleted, topics keep `userMemoryExtractStatus =
 * 'completed'`, so `isTopicExtracted()` skips them forever and nothing can
 * ever be re-extracted. Resetting to `pending` makes the next memory
 * analysis re-process them. Fixes #18498.
 *
 * Scoped by `userId` only (not `mine()`): `deleteAll` removes every memory
 * belonging to the caller regardless of workspace scope, so the reset must
 * cover topics across personal and all workspace scopes alike, otherwise
 * topics in the other scope keep `completed` and stay stuck behind the
 * extraction skip gate.
 */
export const resetMemoryExtractStatus = async (ctx: TopicModelContext) => {
  return ctx.db
    .update(topics)
    .set({
      metadata: sql`jsonb_set(
        jsonb_set(${topics.metadata}, '{userMemoryExtractStatus}', to_jsonb('pending'::text), true),
        '{userMemoryExtractRunState}', '{}'::jsonb, true
      )`,
    })
    .where(eq(topics.userId, ctx.userId));
};
