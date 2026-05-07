import { index, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
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
export const messengerAccountLinks = pgTable(
  'messenger_account_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    platform: varchar('platform', { length: 50 }).notNull(),

    /**
     * Platform-opaque tenant identifier — the same `(platform, platform_user_id)`
     * may exist under different tenants and must not collide:
     *
     * - **Slack**: workspace install → `team_id`; Enterprise Grid org install
     *   → `enterprise_id` (matches `messenger_installations.tenant_id`)
     * - **Discord**: `guild_id`
     * - **Feishu / Lark**: `tenant_key`
     * - **MS Teams**: tenantId
     * - **Telegram** (and any global-token bot): empty string `''` — a single
     *   bot serves every chat, so there's nothing to scope by
     */
    tenantId: varchar('tenant_id', { length: 255 }).default('').notNull(),

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

    ...timestamps,
  },
  (t) => [
    // One IM account per (platform, tenant) binds to exactly one LobeHub user.
    // The tenant column lets the same Slack user id under two workspaces
    // bind to different LobeHub users — without it, the second workspace
    // install would clash on the legacy 2-column index.
    uniqueIndex('messenger_account_links_platform_tenant_user_unique').on(
      t.platform,
      t.tenantId,
      t.platformUserId,
    ),
    // One LobeHub user has at most one IM account per (platform, tenant) —
    // i.e. one user can be linked into Slack workspace A AND workspace B
    // simultaneously, but only one account per workspace.
    uniqueIndex('messenger_account_links_user_platform_tenant_unique').on(
      t.userId,
      t.platform,
      t.tenantId,
    ),
    index('messenger_account_links_active_agent_idx').on(t.activeAgentId),
  ],
);

export const insertMessengerAccountLinkSchema = createInsertSchema(messengerAccountLinks);

export type NewMessengerAccountLink = typeof messengerAccountLinks.$inferInsert;
export type MessengerAccountLinkItem = typeof messengerAccountLinks.$inferSelect;
