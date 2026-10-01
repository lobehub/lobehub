import { type AnyColumn, sql } from 'drizzle-orm';

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
