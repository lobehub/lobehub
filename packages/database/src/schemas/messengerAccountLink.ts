import { isNotNull } from 'drizzle-orm';
import { index, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { timestamps } from './_helpers';
import { agents } from './agent';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Maps a LobeHub user to a single IM account per platform (e.g. one Telegram
 * account ↔ one LobeHub user). The active agent for that IM session is
 * tracked here so the user can switch among ALL their agents from the IM
 * client (`/agents` + `/switch <n>`) or the web UI without re-running the
 * verify-im flow per agent.
 *
 * Most platforms use a shared bot whose credentials live in env or
 * `messenger_installations`. User-scoped credential platforms such as WeChat
 * keep their encrypted connection credentials on this same account aggregate
 * instead: the credential cannot outlive or be shared independently from the
 * bound IM identity.
 */
export const messengerAccountLinks = pgTable(
  'messenger_account_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

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
     * Platform-side application/bot id for user-scoped credential platforms.
     * WeChat stores the scanned iLink bot id here so inbound payloads can fail
     * closed before decrypting credentials. Null for shared-bot platforms.
     */
    applicationId: varchar('application_id', { length: 255 }),

    /**
     * AES-GCM encrypted platform credential JSON. WeChat stores
     * `{ baseUrl, botId, botToken }`; shared-bot platforms leave this null.
     * Server-side model methods must use an explicit credential projection so
     * ordinary account-link API responses never expose this ciphertext.
     */
    credentials: text('credentials'),

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
    // A user-scoped credential bot (WeChat iLink bot id) belongs to exactly
    // one account link — a second link claiming the same bot id must fail
    // closed instead of creating an ambiguous inbound route with the wrong
    // ciphertext. Partial: shared-bot rows keep `application_id` NULL and are
    // unaffected. Mirrors the unique routing keys on `messenger_installations`
    // and `agent_bot_providers`.
    uniqueIndex('messenger_account_links_platform_tenant_application_unique')
      .on(t.platform, t.tenantId, t.applicationId)
      .where(isNotNull(t.applicationId)),
    index('messenger_account_links_active_agent_idx').on(t.activeAgentId),
    index('messenger_account_links_workspace_id_idx').on(t.workspaceId),
  ],
);

export const insertMessengerAccountLinkSchema = createInsertSchema(messengerAccountLinks);

export type NewMessengerAccountLink = typeof messengerAccountLinks.$inferInsert;
export type MessengerAccountLinkItem = typeof messengerAccountLinks.$inferSelect;

/**
 * Row shape safe to return from account-link APIs — excludes the encrypted
 * `credentials` ciphertext, which only explicit credential-scoped reads may
 * project.
 */
export type MessengerAccountLinkPublicItem = Omit<MessengerAccountLinkItem, 'credentials'>;
