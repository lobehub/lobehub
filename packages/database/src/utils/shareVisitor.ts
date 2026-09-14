import { type AnyColumn, isNull, sql } from 'drizzle-orm';

import { messages, topics } from '../schemas';

/**
 * Agent-share visitor topics carry the creator's `userId` (billing/data
 * attribution) plus a non-null `senderId` (the visitor), so plain ownership
 * predicates surface them inside the creator's own workspace. Every
 * creator-facing listing/aggregation over `topics` must AND this in —
 * lists, unread badges, stats, memory extraction, digests. Share-scoped
 * access goes through the dedicated `*BySender` methods instead; visitor
 * usage is reported separately by the Cloud share usage center.
 */
export const notShareVisitorTopic = () => isNull(topics.senderId);

/**
 * Twin of {@link notShareVisitorTopic} for `messages`-table aggregates.
 * Messages carry no `senderId` — visitor authorship is only identifiable
 * through the parent topic, so this correlates a NOT EXISTS against `topics`
 * to keep callers join-free. Messages without a topic are trivially kept.
 */
export const notShareVisitorMessage = () => notShareVisitorTopicRef(messages.topicId);

/**
 * Generic form of {@link notShareVisitorMessage} for any table that references
 * a topic by id (messages, agent operations, …). Correlates a NOT EXISTS
 * against `topics` so the caller needs no join; rows with a NULL topic
 * reference are trivially kept.
 */
export function notShareVisitorTopicRef(topicIdColumn: AnyColumn) {
  // Drizzle's relational query builder (`db.query.<table>.findFirst/findMany`)
  // aliases the queried table to a fixed name and then rewrites references
  // inside `sql`` templates to that alias — so `${topics.id}` was rendering as
  // `"messages"."id"` inside `.findFirst({ where: ... })`, which crashed the
  // moment `ownership()` started ANDing this predicate by default. Hard-code
  // the correlated table alias with `sql.raw` so the inner reference is
  // immune to the outer alias rewriting.
  return sql`NOT EXISTS (SELECT 1 FROM ${topics} WHERE ${sql.raw('"topics"."id"')} = ${topicIdColumn} AND ${sql.raw('"topics"."sender_id"')} IS NOT NULL)`;
}
