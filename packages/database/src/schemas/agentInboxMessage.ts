import type { AgentInboxSourceType } from '@lobechat/types';
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { agentAccounts } from './agentAccount';
import { topics } from './topic';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * The agent's inbox: one row per item that arrived for the agent's attention,
 * whatever channel it came through.
 *
 * An item points at the record that carries the content (`source_type` +
 * `source_id`; today only `mail` → `agent_mails`) and keeps what the inbox
 * itself owns: a display summary, whether it was read, the topic it was
 * handled in, and the wake state. The content stays with its source, so a new
 * channel joins the inbox without a migration.
 *
 * This is deliberately separate from `messages` (the conversation): an item
 * is written by someone outside, is untrusted, and only reaches a run as data.
 */
export const agentInboxMessages = pgTable(
  'agent_inbox_messages',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** The account it arrived at, when the channel has one. */
    accountId: uuid('account_id').references(() => agentAccounts.id, { onDelete: 'cascade' }),

    /** What the item is; selects the table `source_id` points into. */
    sourceType: text('source_type').$type<AgentInboxSourceType>().notNull(),
    /** The source record's id (for `mail`: `agent_mails.id`). */
    sourceId: uuid('source_id').notNull(),

    /** Who it is from, as the list shows it (a mail's sender address). */
    sender: text('sender').notNull(),
    /** One-line title (a mail's subject). */
    title: text('title'),
    /** Short plain-text preview of the content. */
    preview: text('preview'),
    /** Conversation key within the account, for continuing a thread in one topic. */
    threadKey: text('thread_key'),

    /** When it arrived, by the source's clock; the inbox's order. */
    receivedAt: timestamptz('received_at').notNull(),
    /** First read by the agent or the user; null while unread. */
    readAt: timestamptz('read_at'),

    /** The topic the agent handled it in, so a thread continues there. */
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    /**
     * Lease on waking the agent for this item. Taken atomically, so concurrent
     * deliveries start one run; a lease left by a worker that died expires.
     */
    wakeClaimedAt: timestamptz('wake_claimed_at'),
    /**
     * Operations whose `wait` already returned this item, so the same run's
     * next wait moves on to the next arrival.
     */
    waitConsumedBy: jsonb('wait_consumed_by').$type<string[]>().notNull().default([]),

    ...timestamps,
  },
  (t) => [
    // One inbox item per source record.
    uniqueIndex('agent_inbox_messages_source_unique').on(t.sourceType, t.sourceId),
    // The inbox read: one agent's items, newest first; also the unread count.
    index('agent_inbox_messages_agent_received_at_idx').on(t.agentId, t.receivedAt),
    // Arrival polling (`wait`): one agent's items by local ingestion time.
    index('agent_inbox_messages_agent_created_at_idx').on(t.agentId, t.createdAt),
    // Wake budget: per-account and per-(account, sender) arrivals in a recent window.
    index('agent_inbox_messages_account_created_at_idx').on(t.accountId, t.createdAt),
    index('agent_inbox_messages_account_sender_created_at_idx').on(
      t.accountId,
      t.sender,
      t.createdAt,
    ),
    // Continuing a thread in the topic its first item woke.
    index('agent_inbox_messages_account_thread_idx').on(t.accountId, t.threadKey),
    index('agent_inbox_messages_user_id_idx').on(t.userId),
  ],
);

export const insertAgentInboxMessageSchema = createInsertSchema(agentInboxMessages);

export type NewAgentInboxMessage = typeof agentInboxMessages.$inferInsert;
export type AgentInboxMessageItem = typeof agentInboxMessages.$inferSelect;
