import type { AgentAccountKind } from '@lobechat/types';
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { agentAccounts } from './agentAccount';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * The agent's own inbox: every message delivered to one of its accounts.
 *
 * This is a first-class resource, deliberately separate from `messages` (the
 * conversation) and from `agent_bot_providers` (bot integrations). It exists
 * so "the agent has mail" is a thing the runtime can read and the model can
 * be told about, instead of being smeared into an always-on tool slot — the
 * exact shape the earlier channel implementation needed (`lobe-mailbox` in
 * `defaultToolIds` + `alwaysOnToolIds`).
 *
 * One inbound provider delivery maps to one row. `(account_id,
 * provider_message_id)` is unique, so a provider retry (Agent Mail / Linq both
 * redeliver) is idempotent and never duplicates the inbox.
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

    /** The account that received this message. */
    accountId: uuid('account_id')
      .references(() => agentAccounts.id, { onDelete: 'cascade' })
      .notNull(),

    /** Provider that delivered it (`agent-mail`, `linq`, …). */
    provider: text('provider').notNull(),

    /** Denormalized account kind so the inbox can be read without a join. */
    kind: text('kind').$type<AgentAccountKind>().notNull(),

    /** Provider-side message id — the dedupe key that makes retries idempotent. */
    providerMessageId: text('provider_message_id').notNull(),

    /** Address the message came from. */
    from: text('from').notNull(),

    /** The agent's own identifier it was delivered to. */
    to: text('to').notNull(),

    subject: text('subject'),

    /** Normalized body. Quoted history / HTML are already stripped by the provider. */
    text: text('text').notNull(),

    /** Provider-normalized thread key, when the provider supplies one. */
    threadKey: text('thread_key'),

    /**
     * Verification codes pulled out of the body (3–8 digits). Cached on the row
     * so the `wait` primitive answers from the inbox instead of re-parsing at
     * read time.
     */
    codes: jsonb('codes').$type<string[]>().default([]),

    /** Provider-side non-secret extras. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

    /** Provider-reported delivery time (may differ from `created_at`). */
    receivedAt: timestamptz('received_at').notNull(),

    /** First read by the agent; `null` while unread. */
    readAt: timestamptz('read_at'),

    ...timestamps,
  },
  (t) => [
    // Also serves every per-account lookup (its leading column), so there is no
    // separate account_id index.
    uniqueIndex('agent_inbox_messages_account_provider_message_unique').on(
      t.accountId,
      t.providerMessageId,
    ),
    // The inbox read: one agent's messages, newest first.
    index('agent_inbox_messages_agent_received_at_idx').on(t.agentId, t.receivedAt),
    // Arrival polling (waitForMessage): one agent's messages by local ingestion time.
    index('agent_inbox_messages_agent_created_at_idx').on(t.agentId, t.createdAt),
    // Inbound wake budget: per-account and per-(account, sender) counts over a
    // recent createdAt window, run on every delivery.
    index('agent_inbox_messages_account_created_at_idx').on(t.accountId, t.createdAt),
    index('agent_inbox_messages_account_from_created_at_idx').on(
      t.accountId,
      t.from,
      t.createdAt,
    ),
    // Thread lookups: the reply check and continuing a thread in its topic.
    index('agent_inbox_messages_account_thread_idx').on(t.accountId, t.threadKey),
    index('agent_inbox_messages_user_id_idx').on(t.userId),
  ],
);

export const insertAgentInboxMessageSchema = createInsertSchema(agentInboxMessages);

export type NewAgentInboxMessage = typeof agentInboxMessages.$inferInsert;
export type AgentInboxMessageItem = typeof agentInboxMessages.$inferSelect;
