import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { timestamps } from './_helpers';
import { agents } from './agent';
import { users } from './user';

/**
 * Stores per-agent bot provider bindings for external chat platforms.
 *
 * Used for webhook routing: when a Discord/Slack webhook arrives,
 * the `applicationId` is used to look up which agent should handle it.
 */
export const agentBotProviders = pgTable(
  'agent_bot_providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    agentId: text('agent_id')
      .references(() => agents.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** Platform identifier: 'discord' | 'slack' | 'feishu' | ... */
    platform: varchar('platform', { length: 50 }).notNull(),

    /** Platform-specific application/bot ID used for webhook routing */
    applicationId: varchar('application_id', { length: 255 }).notNull(),

    /** Encrypted credentials string (decrypted to JSON with botToken, publicKey, etc.) */
    credentials: text('credentials'),

    /** User-configurable settings (dm policy, charLimit, debounce, etc.) */
    settings: jsonb('settings').$type<Record<string, unknown>>().default({}),

    enabled: boolean('enabled').default(true).notNull(),

    ...timestamps,
  },
  (t) => [
    // Fast lookup: platform + applicationId → agent
    uniqueIndex('agent_bot_providers_platform_app_id_unique').on(t.platform, t.applicationId),
    index('agent_bot_providers_platform_idx').on(t.platform),
    index('agent_bot_providers_agent_id_idx').on(t.agentId),
    index('agent_bot_providers_user_id_idx').on(t.userId),
  ],
);

export const insertAgentBotProviderSchema = createInsertSchema(agentBotProviders);

export type NewAgentBotProvider = typeof agentBotProviders.$inferInsert;
export type AgentBotProviderItem = typeof agentBotProviders.$inferSelect;
