import type { AiProviderConfig, AiProviderSettings } from '@lobechat/types';
import { isNotNull, isNull } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { AiModelSettings } from 'model-bank';

import { timestamps } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

export const aiProviders = pgTable(
  'ai_providers',
  {
    id: varchar('id', { length: 64 }).notNull(),
    name: text('name'),

    /**
     * Surrogate primary key for the workspace-scoped rebuild. Migration 0110
     * replaced the composite PK (id, provider_id, user_id) with this single-col
     * surrogate so that workspace-scoped partial unique indexes can enforce
     * business uniqueness. The PK itself no longer carries unique semantics.
     */
    _id: uuid('_id').defaultRandom().notNull().primaryKey(),

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

    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    ...timestamps,
  },
  (table) => [
    uniqueIndex('ai_providers_id_user_id_unique')
      .on(table.id, table.userId)
      .where(isNull(table.workspaceId)),
    uniqueIndex('ai_providers_id_user_id_workspace_id_unique')
      .on(table.id, table.userId, table.workspaceId)
      .where(isNotNull(table.workspaceId)),
    index('ai_providers_user_id_idx').on(table.userId),
    index('ai_providers_workspace_id_idx').on(table.workspaceId),
  ],
);

export type NewAiProviderItem = Omit<typeof aiProviders.$inferInsert, 'userId'>;
export type AiProviderSelectItem = typeof aiProviders.$inferSelect;

export const aiModels = pgTable(
  'ai_models',
  {
    id: varchar('id', { length: 150 }).notNull(),

    /**
     * Surrogate primary key for the workspace-scoped rebuild. Migration 0110
     * replaced the composite PK (id, provider_id, user_id) with this single-col
     * surrogate so that workspace-scoped partial unique indexes can enforce
     * business uniqueness. The PK itself no longer carries unique semantics.
     */
    _id: uuid('_id').defaultRandom().notNull().primaryKey(),

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

    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    ...timestamps,
  },
  (table) => [
    uniqueIndex('ai_models_id_provider_id_user_id_unique')
      .on(table.id, table.providerId, table.userId)
      .where(isNull(table.workspaceId)),
    uniqueIndex('ai_models_id_provider_id_user_id_workspace_id_unique')
      .on(table.id, table.providerId, table.userId, table.workspaceId)
      .where(isNotNull(table.workspaceId)),
    index('ai_models_user_id_idx').on(table.userId),
    index('ai_models_workspace_id_idx').on(table.workspaceId),
  ],
);

export type NewAiModelItem = Omit<typeof aiModels.$inferInsert, 'userId'>;
export type AiModelSelectItem = typeof aiModels.$inferSelect;
