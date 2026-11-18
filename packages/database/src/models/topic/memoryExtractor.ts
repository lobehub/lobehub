import { and, count, eq, gt, gte, lte, ne, or, sql } from 'drizzle-orm';

import { messages, topics } from '../../schemas';
import type { TopicModelContext } from './context';
import type { ListTopicsForMemoryExtractorCursor } from './types';

/**
 * `created_at` keeps microseconds, but the pagination cursor round-trips through a JS Date and
 * keeps only milliseconds. Comparing and ordering on the millisecond-truncated value keeps the
 * cursor and the rows on one scale; on the raw column every topic in the cursor's millisecond is
 * listed again, so a page never advances.
 */
const topicsCreatedAtMs = sql<Date>`date_trunc('milliseconds', ${topics.createdAt})`;

export const listTopicsForMemoryExtractor = async (
  ctx: TopicModelContext,
  options: {
    cursor?: ListTopicsForMemoryExtractorCursor;
    endDate?: Date;
    ignoreExtracted?: boolean;
    limit?: number;
    /**
     * Retry a topic whose last extraction failed only while it has automatic retries left
     * (`MEMORY_EXTRACTION_AUTO_RETRIES`), or once a message arrived after that run.
     * Unattended runs set this so a transient failure (a gateway timeout, a provider
     * outage) is made up for, while a deterministic one (an oversized conversation, a
     * model that keeps returning invalid output) is not paid for again every hour; a
     * user-initiated run still retries it.
     */
    limitFailedRetries?: boolean;
    /** Only messages created before this count as new, so a conversation still being written waits. */
    settledBefore?: Date;
    startDate?: Date;
  } = {},
) => {
  const cursorCondition = options.cursor
    ? and(
        ne(topics.id, options.cursor.id),
        or(
          gt(topicsCreatedAtMs, options.cursor.createdAt),
          and(eq(topicsCreatedAtMs, options.cursor.createdAt), gt(topics.id, options.cursor.id)),
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
    orderBy: (fields, { asc }) => [asc(topicsCreatedAtMs), asc(fields.id)],
    where: and(
      ctx.ownership(),
      // Share-visitor conversations are not the creator's own speech — never
      // feed them into the creator's memory extraction.
      ctx.notShareVisitor(),
      options.startDate ? gte(topics.createdAt, options.startDate) : undefined,
      options.endDate ? lte(topics.createdAt, options.endDate) : undefined,
      options.ignoreExtracted ? undefined : hasConversationToExtract(options.settledBefore),
      options.limitFailedRetries ? retryableAfterFailure : undefined,
      cursorCondition,
    ),
  });
};

/**
 * A topic has conversation left to extract when a user or assistant message was created after
 * its watermark: the last message a successful run extracted (`extractedThrough`). A topic
 * completed before the watermark existed falls back to `lastMessageAt`, which its last
 * successful run recorded (a completed topic with neither counts as fully extracted); one never
 * extracted has no watermark at all. Tool output is not
 * conversation and never makes a topic due.
 *
 * The watermark comes from a JS Date (milliseconds) while Postgres keeps microseconds, so the
 * message it names is compared at millisecond precision; otherwise it would always look new.
 *
 * No null tests on computed expressions (see the note on TopicModel): a missing watermark
 * COALESCEs to '-infinity'.
 */
const hasConversationToExtract = (settledBefore?: Date) => sql`EXISTS (
  SELECT 1 FROM ${messages} AS m
  WHERE m.topic_id = ${topics.id}
    AND m.role IN ('user', 'assistant')
    -- Extraction reads only messages with text; a tool-only turn must not keep the topic due.
    AND COALESCE(m.content, '') ~ '[^[:space:]]'
    AND date_trunc('milliseconds', m.created_at) > COALESCE(
      (${topics.metadata} #>> '{userMemoryExtractRunState,extractedThrough}')::timestamptz,
      CASE WHEN COALESCE(${topics.metadata}->>'userMemoryExtractStatus', '') = 'completed'
        THEN COALESCE(
          (${topics.metadata} #>> '{userMemoryExtractRunState,lastMessageAt}')::timestamptz,
          'infinity'::timestamptz
        )
      END,
      '-infinity'::timestamptz
    )
    ${settledBefore ? sql`AND m.created_at < ${settledBefore.toISOString()}::timestamptz` : sql``}
)`;

/**
 * Automatic retries a failed topic gets on an unchanged conversation: one per unattended run
 * (hourly), after which it waits for a new message.
 */
export const MEMORY_EXTRACTION_AUTO_RETRIES = 3;

// The relational query builder renders column refs unqualified, so the subquery
// names its columns through an alias. No null tests on computed expressions (see
// the note on TopicModel): a failed run without a recorded time compares against
// 'infinity', so it counts as having no newer message, and a failure recorded
// before runs were counted counts as the first.
const retryableAfterFailure = sql`NOT (
  COALESCE(${topics.metadata}->>'userMemoryExtractStatus', '') = 'failed'
  AND COALESCE((${topics.metadata} #>> '{userMemoryExtractRunState,failedRuns}')::int, 1)
    > ${MEMORY_EXTRACTION_AUTO_RETRIES}
  AND NOT EXISTS (
    SELECT 1 FROM ${messages} AS m
    WHERE m.topic_id = ${topics.id}
      AND m.created_at > COALESCE(
        (${topics.metadata} #>> '{userMemoryExtractRunState,lastRunAt}')::timestamptz,
        'infinity'::timestamptz
      )
  )
)`;

export const countTopicsForMemoryExtractor = async (
  ctx: TopicModelContext,
  options: {
    endDate?: Date;
    ignoreExtracted?: boolean;
    settledBefore?: Date;
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
        options.startDate ? gte(topics.createdAt, options.startDate) : undefined,
        options.endDate ? lte(topics.createdAt, options.endDate) : undefined,
        options.ignoreExtracted ? undefined : hasConversationToExtract(options.settledBefore),
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
