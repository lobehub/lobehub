import { boolean, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { timestamps } from './_helpers';

/**
 * System-level (deployment-wide) bot provider credentials. Distinct from
 * `agent_bot_providers` (per-user-per-agent) — this table holds the App-level
 * credentials for the LobeHub-distributed messenger bots that any user can
 * link their account to. Singleton per `platform` (one Discord App per
 * deployment, one Telegram bot, etc.).
 *
 * Replaces the env-var-based config (`LOBE_DISCORD_*`, `LOBE_TELEGRAM_*`,
 * `LOBE_SLACK_*`) so credentials become DB-backed and operations can be
 * managed from develop-center without redeploys.
 *
 * Per-tenant Slack workspace tokens still live in `messenger_installations`;
 * this table only carries the App-level Slack OAuth client credentials.
 *
 * `credentials` is AES-GCM encrypted JSON via `KeyVaultsGateKeeper`. The
 * decrypted plaintext shape varies per platform:
 *
 *   - discord:  { botToken, publicKey, botUsername? }
 *   - telegram: { botToken, botUsername?, webhookSecret? }
 *   - slack:    { clientId, clientSecret, signingSecret }
 *
 * Public app identifiers (`applicationId` / Slack `appId`) live in the
 * top-level `application_id` column — they're not secrets and the consumer
 * needs them without paying the decrypt cost.
 */
export const systemBotProviders = pgTable(
  'system_bot_providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Platform identifier: 'discord' | 'telegram' | 'slack'. */
    platform: varchar('platform', { length: 50 }).notNull(),

    /** Soft on/off — disabled rows are ignored by the messenger router. */
    enabled: boolean('enabled').default(true).notNull(),

    /** AES-GCM encrypted credentials JSON; shape varies per platform (see file header). */
    credentials: text('credentials').notNull(),

    /**
     * Public application identifier — Discord App ID, Slack App ID, etc.
     * Plaintext: it's a public ID and consumers (and the admin UI) read it
     * without decrypting credentials. Null for telegram (no notion of an
     * App ID — the bot token's prefix is the closest analogue, but we don't
     * persist it).
     */
    applicationId: varchar('application_id', { length: 255 }),

    /**
     * Per-platform tunable settings (e.g. Slack `connectionMode`). Plaintext
     * JSONB — the shape is owned by `PlatformDefinition.schema` in
     * develop-center / lobehub-dev.
     */
    settings: jsonb('settings').$type<Record<string, unknown>>().default({}).notNull(),

    /**
     * 'websocket' | 'webhook' — passed through to MessageGateway.connect()
     * so the worker picks the right transport. Null falls back to the
     * platform default in `messageGatewayService`.
     */
    connectionMode: varchar('connection_mode', { length: 20 }),

    ...timestamps,
  },
  (t) => [
    // Singleton per platform — one row per (platform). Lift this constraint
    // if/when we need to run multiple Discord Apps from one deployment.
    uniqueIndex('system_bot_providers_platform_unique').on(t.platform),
  ],
);

export const insertSystemBotProviderSchema = createInsertSchema(systemBotProviders);

export type NewSystemBotProvider = typeof systemBotProviders.$inferInsert;
export type SystemBotProviderItem = typeof systemBotProviders.$inferSelect;
