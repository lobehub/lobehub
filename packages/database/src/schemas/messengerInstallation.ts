import { index, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';

/**
 * Per-tenant install record for messenger platforms that distribute via OAuth
 * (Slack today; Feishu / MS Teams later). Keyed by `(platform, application_id,
 * tenant_id)` so a single LobeHub deployment can serve many workspaces of the
 * same Slack App without collisions.
 *
 * Distinct from `agent_bot_providers` (per-agent-per-user bot bindings): this
 * row represents the LobeHub-owned, Marketplace-distributed app installed
 * into a workspace, not a user-deployed bot. Routing key is `tenant_id`,
 * not the agent.
 *
 * `tenant_id` is opaque per platform — Slack workspace install stores
 * `team_id`, Slack Enterprise Grid org install stores `enterprise_id` (with
 * `metadata.isEnterpriseInstall = true`), Feishu stores `tenant_key`, MS
 * Teams stores tenantId. Adding a new per-tenant platform requires zero
 * schema changes.
 */
export const messengerInstallations = pgTable(
  'messenger_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** 'slack' | 'feishu' | 'msteams' | ... */
    platform: varchar('platform', { length: 50 }).notNull(),

    /** Platform-opaque tenant identifier — see file header. */
    tenantId: varchar('tenant_id', { length: 255 }).notNull(),

    /** Platform-side application/bot id (Slack `app_id`, Feishu `app_id`, …). */
    applicationId: varchar('application_id', { length: 255 }).notNull(),

    /** Bot user id within the tenant (Slack `bot_user_id`, …). Optional. */
    accountId: varchar('account_id', { length: 255 }),

    /**
     * AES-GCM encrypted JSON blob: `{ botToken, refreshToken?, … }`. Plaintext
     * shape varies per platform; the typed `InstallationStore` wrappers narrow
     * it. Encryption is via `KeyVaultsGateKeeper` — same gatekeeper as
     * `agent_bot_providers`.
     */
    credentials: text('credentials').notNull(),

    /**
     * Platform-opaque metadata: tenant display name, granted scope string,
     * Slack `enterprise_id`, `isEnterpriseInstall`, etc. Lives outside
     * `credentials` because it's safe to read without decryption (e.g. the
     * `team.info` cached display name shown on the verify-im page).
     */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),

    /**
     * When the bot token expires. Promoted out of `credentials` so a
     * background rotation job can index on it without decrypting every row.
     * Null = no rotation (legacy install or non-rotating platform).
     */
    tokenExpiresAt: timestamptz('token_expires_at'),

    /** LobeHub user who clicked "Connect Slack" — bound at OAuth callback. */
    installedByUserId: text('installed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    /** Platform user id of the installer (Slack `authed_user.id`, …). */
    installedByPlatformUserId: varchar('installed_by_platform_user_id', { length: 255 }),

    /** Set on `app_uninstalled` / `tokens_revoked` so resolver can short-circuit. */
    revokedAt: timestamptz('revoked_at'),

    ...timestamps,
  },
  (t) => [
    // Routing key: one install per (platform, application, tenant)
    uniqueIndex('messenger_installations_platform_app_tenant_unique').on(
      t.platform,
      t.applicationId,
      t.tenantId,
    ),
    index('messenger_installations_platform_tenant_idx').on(t.platform, t.tenantId),
    // Index for the rotation job: only active installs with a known expiry
    index('messenger_installations_token_expires_at_idx').on(t.tokenExpiresAt),
  ],
);

export const insertMessengerInstallationSchema = createInsertSchema(messengerInstallations);

export type NewMessengerInstallation = typeof messengerInstallations.$inferInsert;
export type MessengerInstallationItem = typeof messengerInstallations.$inferSelect;
