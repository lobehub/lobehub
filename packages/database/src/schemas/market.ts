import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';

export const marketAccounts = pgTable(
  'market_accounts',
  {
    id: serial('id').primaryKey(),
    lobeUserId: text('lobe_user_id').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name'),
    userName: varchar('user_name', { length: 100 }),
    namespace: varchar('namespace', { length: 100 }).notNull(),
    avatarUrl: text('avatar_url'),
    meta: jsonb('meta').$type<Record<string, unknown>>().default({}),
    followerCount: integer('follower_count').notNull().default(0),
    followingCount: integer('following_count').notNull().default(0),
    type: text('type').notNull().default('user'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('market_accounts_lobe_user_id_unique').on(table.lobeUserId),
    uniqueIndex('market_accounts_email_unique').on(table.email),
    uniqueIndex('market_accounts_namespace_unique').on(table.namespace),
    uniqueIndex('market_accounts_user_name_unique').on(table.userName),
  ],
);

export const marketAgents = pgTable(
  'market_agents',
  {
    id: serial('id').primaryKey(),
    identifier: varchar('identifier', { length: 128 }).notNull(),
    ownerId: integer('owner_id')
      .references(() => marketAccounts.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    homepage: text('homepage'),
    status: text('status', { enum: ['published', 'unpublished', 'archived', 'deprecated'] })
      .notNull()
      .default('unpublished'),
    visibility: text('visibility', { enum: ['public', 'private', 'internal'] })
      .notNull()
      .default('public'),
    currentVersionId: integer('current_version_id'),
    forkedFromAgentId: integer('forked_from_agent_id'),
    isFeatured: boolean('is_featured').notNull().default(false),
    isOfficial: boolean('is_official').notNull().default(false),
    installCount: integer('install_count').notNull().default(0),
    forkCount: integer('fork_count').notNull().default(0),
    likeCount: integer('like_count').notNull().default(0),
    favoriteCount: integer('favorite_count').notNull().default(0),
    ratingCount: integer('rating_count').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('market_agents_identifier_unique').on(table.identifier),
    index('market_agents_owner_id_idx').on(table.ownerId),
    index('market_agents_status_visibility_idx').on(table.status, table.visibility),
  ],
);

export const marketAgentVersions = pgTable(
  'market_agent_versions',
  {
    id: serial('id').primaryKey(),
    agentId: integer('agent_id')
      .references(() => marketAgents.id, { onDelete: 'cascade' })
      .notNull(),
    version: varchar('version', { length: 64 }).notNull().default('1.0.0'),
    versionNumber: integer('version_number').notNull(),
    isLatest: boolean('is_latest').notNull().default(true),
    isValidated: boolean('is_validated').notNull().default(false),
    a2aProtocolVersion: text('a2a_protocol_version'),
    avatar: text('avatar'),
    category: text('category'),
    changelog: text('changelog'),
    config: jsonb('config').$type<Record<string, unknown>>().default({}),
    defaultInputModes: text('default_input_modes').array().default([]),
    defaultOutputModes: text('default_output_modes').array().default([]),
    description: text('description').notNull().default(''),
    documentationUrl: text('documentation_url'),
    editorData: jsonb('editor_data').$type<Record<string, unknown>>().default({}),
    extensions: jsonb('extensions').$type<Array<Record<string, unknown>>>().default([]),
    hasPushNotifications: boolean('has_push_notifications').default(false),
    hasStateTransitionHistory: boolean('has_state_transition_history').default(false),
    hasStreaming: boolean('has_streaming').default(false),
    interfaces: jsonb('interfaces').$type<Array<Record<string, unknown>>>().default([]),
    name: text('name').notNull(),
    preferredTransport: text('preferred_transport'),
    securityRequirements: jsonb('security_requirements')
      .$type<Array<Record<string, unknown>>>()
      .default([]),
    securitySchemes: jsonb('security_schemes').$type<Record<string, unknown>>().default({}),
    skills: jsonb('skills').$type<Array<Record<string, unknown>>>().default([]),
    summary: text('summary').notNull().default(''),
    supportsAuthenticatedExtendedCard: boolean('supports_authenticated_extended_card').default(
      false,
    ),
    tags: text('tags').array().default([]),
    tokenUsage: integer('token_usage').notNull().default(0),
    url: text('url'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('market_agent_versions_agent_id_version_number_unique').on(
      table.agentId,
      table.versionNumber,
    ),
    index('market_agent_versions_agent_id_idx').on(table.agentId),
  ],
);

export const marketAgentEvents = pgTable(
  'market_agent_events',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id').references(() => marketAccounts.id, { onDelete: 'set null' }),
    agentId: integer('agent_id')
      .references(() => marketAgents.id, { onDelete: 'cascade' })
      .notNull(),
    event: text('event', { enum: ['add', 'chat', 'click'] }).notNull(),
    source: text('source'),
    ...timestamps,
  },
  (table) => [
    index('market_agent_events_agent_id_idx').on(table.agentId),
    index('market_agent_events_account_id_idx').on(table.accountId),
  ],
);

export type MarketAccountItem = typeof marketAccounts.$inferSelect;
export type NewMarketAccount = typeof marketAccounts.$inferInsert;
export type MarketAgentItem = typeof marketAgents.$inferSelect;
export type NewMarketAgent = typeof marketAgents.$inferInsert;
export type MarketAgentVersionItem = typeof marketAgentVersions.$inferSelect;
export type NewMarketAgentVersion = typeof marketAgentVersions.$inferInsert;
export type MarketAgentEventItem = typeof marketAgentEvents.$inferSelect;
export type NewMarketAgentEvent = typeof marketAgentEvents.$inferInsert;
