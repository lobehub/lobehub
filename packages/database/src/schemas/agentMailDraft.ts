import type { AgentMailAddress, AgentMailComposeMode } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { agentAccounts } from './agentAccount';
import { agentMails } from './agentMail';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Mail a person is still writing from an agent's address. Not mail yet, so it
 * lives apart from `agent_mails`: nothing that reads mail can mistake it for
 * something sent or received. Sending deletes the row.
 */
export const agentMailDrafts = pgTable(
  'agent_mail_drafts',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** The address it will go out from. */
    accountId: uuid('account_id')
      .references(() => agentAccounts.id, { onDelete: 'cascade' })
      .notNull(),

    mode: text('mode').$type<AgentMailComposeMode>().notNull().default('compose'),
    /** The mail being answered or forwarded; absent for a new mail. */
    sourceMailId: uuid('source_mail_id').references(() => agentMails.id, { onDelete: 'set null' }),

    to: jsonb('to').$type<AgentMailAddress[]>().notNull().default([]),
    cc: jsonb('cc').$type<AgentMailAddress[]>().notNull().default([]),
    bcc: jsonb('bcc').$type<AgentMailAddress[]>().notNull().default([]),
    subject: text('subject'),
    text: text('text').notNull().default(''),

    /** Lease taken while sending, so a double submit cannot send twice. */
    sendingAt: timestamptz('sending_at'),

    ...timestamps,
  },
  (t) => [
    // One draft per mail and way of answering it: replying again resumes it.
    uniqueIndex('agent_mail_drafts_account_source_mode_unique')
      .on(t.accountId, t.sourceMailId, t.mode)
      .where(sql`${t.sourceMailId} is not null`),
    index('agent_mail_drafts_account_updated_at_idx').on(t.accountId, t.updatedAt),
    index('agent_mail_drafts_agent_updated_at_idx').on(t.agentId, t.updatedAt),
    index('agent_mail_drafts_user_id_idx').on(t.userId),
  ],
);

export const insertAgentMailDraftSchema = createInsertSchema(agentMailDrafts);

export type NewAgentMailDraft = typeof agentMailDrafts.$inferInsert;
export type AgentMailDraftItem = typeof agentMailDrafts.$inferSelect;
