import type { AgentMailAddress, AgentMailAttachment, AgentMailDirection } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { agentAccounts } from './agentAccount';
import { signals } from './signal';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * The relay checks' view of a purged mail: `text` is the whole mail compacted to
 * letters and digits, `secrets` the links, tokens and mixed runs found in it.
 * Stored when the content is wiped, so the row keeps refusing to be relayed.
 */
export interface AgentMailRelayGuard {
  secrets: string[];
  text: string;
}

/**
 * Mail an agent's mail account received or sent — one row per message.
 *
 * Everything mail-specific lives here: addressing, subject, body, the RFC
 * threading headers and attachment descriptors. Attachments are descriptors
 * only: the bytes stay with the mail provider (lobe.id) and are fetched
 * through it, never stored in LobeHub.
 *
 * Sent mail is kept too, so a thread reads whole from LobeHub's side and the
 * reply checks do not depend on the provider. `(account_id,
 * provider_message_id)` is unique, so recording the same message twice is
 * idempotent.
 */
export const agentMails = pgTable(
  'agent_mails',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** The agent's mail account that received or sent it. */
    accountId: uuid('account_id')
      .references(() => agentAccounts.id, { onDelete: 'cascade' })
      .notNull(),
    /** The signal an inbound mail was parsed from; absent for sent mail. */
    signalId: uuid('signal_id').references(() => signals.id, { onDelete: 'set null' }),

    direction: text('direction').$type<AgentMailDirection>().notNull(),

    /** Mail provider, e.g. `agent-mail`. */
    provider: text('provider').notNull(),
    /** The provider's id for the message; its key for the body and attachments. */
    providerMessageId: text('provider_message_id').notNull(),

    /** RFC 5322 `Message-ID`. */
    messageId: text('message_id'),
    /** RFC 5322 `In-Reply-To`. */
    inReplyTo: text('in_reply_to'),
    /** RFC 5322 `References`, oldest first. */
    references: jsonb('references').$type<string[]>().notNull().default([]),
    /** The thread's root key (first `References` entry, else the message id). */
    threadKey: text('thread_key'),

    /** Sender address, lowercased; the name lives in `from_name`. */
    fromAddress: text('from_address').notNull(),
    fromName: text('from_name'),
    to: jsonb('to').$type<AgentMailAddress[]>().notNull().default([]),
    cc: jsonb('cc').$type<AgentMailAddress[]>().notNull().default([]),
    /** Blind copies of a sent mail; inbound mail never reveals them. */
    bcc: jsonb('bcc').$type<AgentMailAddress[]>().notNull().default([]),
    replyTo: jsonb('reply_to').$type<AgentMailAddress[]>().notNull().default([]),

    subject: text('subject'),
    /** Plain-text body with quoted history stripped. The HTML stays with the provider. */
    text: text('text').notNull().default(''),

    attachments: jsonb('attachments').$type<AgentMailAttachment[]>().notNull().default([]),
    /** Verification codes extracted from the body, for waits and relay checks. */
    codes: jsonb('codes').$type<string[]>().notNull().default([]),

    /** When the provider received it (inbound) or accepted it for sending (outbound). */
    deliveredAt: timestamptz('delivered_at').notNull(),

    /** Mailbox state, shared by everyone who can see this agent's mail. */
    starredAt: timestamptz('starred_at'),
    /**
     * A person asked to see this as unread. Separate from the inbox's `read_at`
     * on purpose: wakes and digests key off `read_at`, and clearing it would
     * make an already-handled mail wake the agent again.
     */
    markedUnreadAt: timestamptz('marked_unread_at'),
    /** Moved to the trash; restoring clears it. */
    trashedAt: timestamptz('trashed_at'),
    /**
     * Permanently deleted: content is wiped but the row stays, so delivery
     * idempotency, wake budgets and relay checks keep counting it.
     */
    purgedAt: timestamptz('purged_at'),
    /**
     * Lease taken before the provider copy is deleted, so the mail cannot be
     * restored while it is being destroyed on the provider.
     */
    purgeClaimedAt: timestamptz('purge_claimed_at'),
    /**
     * What the relay checks read out of `subject` and `text`, taken before a
     * purge wipes them: the whole mail compacted to letters and digits, and the
     * secrets extracted from it. Without it, purging a message from another
     * sender would delete the evidence that stops an unattended reply from
     * relaying its link or token to somebody else.
     */
    relayGuard: jsonb('relay_guard').$type<AgentMailRelayGuard>(),

    ...timestamps,
  },
  (t) => [
    // Also serves every per-account lookup through its leading column.
    uniqueIndex('agent_mails_account_provider_message_unique').on(t.accountId, t.providerMessageId),
    // Thread reads and the reply check: one account's thread.
    index('agent_mails_account_thread_idx').on(t.accountId, t.threadKey),
    // Relay checks: one agent's recent mail from senders other than the recipient.
    index('agent_mails_agent_delivered_at_idx').on(t.agentId, t.deliveredAt),
    index('agent_mails_signal_id_idx').on(t.signalId),
    index('agent_mails_user_id_idx').on(t.userId),
    // Folder reads of one address: inbox and sent, newest first.
    index('agent_mails_account_folder_idx')
      .on(t.accountId, t.direction, t.deliveredAt)
      .where(sql`${t.trashedAt} is null and ${t.purgedAt} is null`),
    // The same reads across a workspace agent's addresses.
    index('agent_mails_workspace_agent_folder_idx')
      .on(t.workspaceId, t.agentId, t.direction, t.deliveredAt)
      .where(sql`${t.trashedAt} is null and ${t.purgedAt} is null`),
    index('agent_mails_account_trashed_idx')
      .on(t.accountId, t.trashedAt)
      .where(sql`${t.trashedAt} is not null and ${t.purgedAt} is null`),
    index('agent_mails_account_starred_idx')
      .on(t.accountId, t.deliveredAt)
      .where(sql`${t.starredAt} is not null and ${t.trashedAt} is null and ${t.purgedAt} is null`),
  ],
);

export const insertAgentMailSchema = createInsertSchema(agentMails);

export type NewAgentMail = typeof agentMails.$inferInsert;
export type AgentMailItem = typeof agentMails.$inferSelect;
