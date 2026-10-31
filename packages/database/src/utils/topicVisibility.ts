import { type AnyColumn, isNull, ne, or, sql } from 'drizzle-orm';

import { topics } from '../schemas';

/**
 * Keep a row when it has no topic parent, or when that parent is still live.
 *
 * Topic soft deletion deliberately leaves child messages unstamped, so direct
 * message-table reads must carry this fence in addition to their own recycle-
 * bin predicate. The inner column names are fixed for the same reason as
 * `notShareVisitorTopicRef`: relational-query aliases must not rewrite the
 * correlated topic columns to the outer table alias.
 */
export const hasLiveParentTopic = (topicIdColumn: AnyColumn) =>
  sql`(${topicIdColumn} IS NULL OR EXISTS (SELECT 1 FROM ${topics} WHERE ${sql.raw('"topics"."id"')} = ${topicIdColumn} AND ${sql.raw('"topics"."is_deleted"')} IS NOT TRUE))`;

/** `topics.trigger` of an Agent's private execution context for a Channel request. */
export const CHANNEL_TOPIC_TRIGGER = 'channel';

/**
 * Channel run topics carry other members' Channel content (the request and any
 * history the Agent read) and are surfaced only through the Channel UI. Every
 * user-facing topic listing, search or aggregate must AND this in; the runtime
 * paths that execute inside the topic do not.
 */
export const notChannelTopic = () =>
  or(isNull(topics.trigger), ne(topics.trigger, CHANNEL_TOPIC_TRIGGER));

/**
 * Twin of {@link notChannelTopic} for tables that reference a topic by id
 * (messages). Rows without a topic are kept. Inner column names are fixed for
 * the same alias reason as {@link hasLiveParentTopic}.
 */
export const notChannelTopicRef = (topicIdColumn: AnyColumn) =>
  sql`NOT EXISTS (SELECT 1 FROM ${topics} WHERE ${sql.raw('"topics"."id"')} = ${topicIdColumn} AND ${sql.raw('"topics"."trigger"')} = ${CHANNEL_TOPIC_TRIGGER})`;
