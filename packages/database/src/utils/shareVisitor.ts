import { isNull, sql } from 'drizzle-orm';

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
export const notShareVisitorMessage = () =>
  sql`NOT EXISTS (SELECT 1 FROM ${topics} WHERE ${topics.id} = ${messages.topicId} AND ${topics.senderId} IS NOT NULL)`;
