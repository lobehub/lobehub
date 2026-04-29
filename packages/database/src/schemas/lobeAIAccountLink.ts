import { index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { timestamps } from './_helpers';
import { agents } from './agent';
import { users } from './user';

/**
 * Maps a LobeHub user to a single IM account per platform (e.g. one Telegram
 * account ↔ one LobeHub user). The active agent for that IM session is
 * tracked here so the user can switch among ALL their agents from the IM
 * client (`/agents` + `/switch <n>`) or the web UI without re-running the
 * verify-im flow per agent.
 *
 * Distinct from `agent_bot_providers` (per-user-deployed bots): the bot
 * itself is shared (credentials in env), and the routing key is the IM
 * account, not the agent.
 */
export const lobeAIAccountLinks = pgTable(
  'lobeai_account_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    platform: varchar('platform', { length: 50 }).notNull(),

    /** Platform-side user ID (Telegram user id, Slack user id, etc.) */
    platformUserId: varchar('platform_user_id', { length: 255 }).notNull(),

    /** Optional platform-side display name (Telegram @username, Slack real_name, etc.) */
    platformUsername: text('platform_username'),

    /**
     * Currently selected agent for this IM session. Nullable so a fresh link
     * can sit "agent-less" until the user picks one via /switch or the UI;
     * `set null` on agent delete so a deleted agent doesn't orphan the link.
     */
    activeAgentId: text('active_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),

    linkedAt: timestamp('linked_at', { withTimezone: true }).defaultNow().notNull(),

    ...timestamps,
  },
  (t) => [
    // One IM account binds to exactly one LobeHub user
    uniqueIndex('lobeai_account_links_platform_user_unique').on(t.platform, t.platformUserId),
    // One LobeHub user has at most one IM account per platform
    uniqueIndex('lobeai_account_links_user_platform_unique').on(t.userId, t.platform),
    index('lobeai_account_links_active_agent_idx').on(t.activeAgentId),
  ],
);

export const insertLobeAIAccountLinkSchema = createInsertSchema(lobeAIAccountLinks);

export type NewLobeAIAccountLink = typeof lobeAIAccountLinks.$inferInsert;
export type LobeAIAccountLinkItem = typeof lobeAIAccountLinks.$inferSelect;
