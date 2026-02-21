/* eslint-disable sort-keys-fix/sort-keys-fix  */
import type { AiProviderConfig, AiProviderSettings } from '@lobechat/types';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  varchar,
} from 'drizzle-orm/pg-core';
import type { AiModelSettings } from 'model-bank';

import { timestamps } from './_helpers';
import { users } from './user';

export const aiProviders = pgTable(
  'ai_providers',
  {
    id: varchar('id', { length: 64 }).notNull(),
    name: text('name'),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    sort: integer('sort'),
    enabled: boolean('enabled'),
    fetchOnClient: boolean('fetch_on_client'),
    checkModel: text('check_model'),
    logo: text('logo'),
    description: text('description'),

    // need to be encrypted
    keyVaults: text('key_vaults'),
    source: varchar('source', { enum: ['builtin', 'custom'], length: 20 }),
    settings: jsonb('settings')
      .$defaultFn(() => ({}))
      .$type<AiProviderSettings>(),

    config: jsonb('config')
      .$defaultFn(() => ({}))
      .$type<AiProviderConfig>(),

    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.id, table.userId] }),
    index('ai_providers_user_id_idx').on(table.userId),
  ],
);

export type NewAiProviderItem = Omit<typeof aiProviders.$inferInsert, 'userId'>;
export type AiProviderSelectItem = typeof aiProviders.$inferSelect;

export const aiModels = pgTable(
  'ai_models',
  {
    id: varchar('id', { length: 150 }).notNull(),
    displayName: varchar('display_name', { length: 200 }),
    description: text('description'),
    organization: varchar('organization', { length: 100 }),
    enabled: boolean('enabled'),
    providerId: varchar('provider_id', { length: 64 }).notNull(),
    type: varchar('type', { length: 20 }).default('chat').notNull(),
    sort: integer('sort'),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    pricing: jsonb('pricing'),
    parameters: jsonb('parameters').default({}),
    config: jsonb('config'),
    abilities: jsonb('abilities').default({}),
    contextWindowTokens: integer('context_window_tokens'),
    source: varchar('source', { enum: ['remote', 'custom', 'builtin'], length: 20 }),
    releasedAt: varchar('released_at', { length: 10 }),
    settings: jsonb('settings').default({}).$type<AiModelSettings>(),

    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.id, table.providerId, table.userId] }),
    index('ai_models_user_id_idx').on(table.userId),
  ],
);

export type NewAiModelItem = Omit<typeof aiModels.$inferInsert, 'userId'>;
export type AiModelSelectItem = typeof aiModels.$inferSelect;
