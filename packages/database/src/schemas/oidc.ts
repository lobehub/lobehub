/* eslint-disable sort-keys-fix/sort-keys-fix  */
import { boolean, index, jsonb, pgTable, primaryKey, text, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';

/**
 * OIDC authorization code
 * One of the models that oidc-provider needs to persist
 */
export const oidcAuthorizationCodes = pgTable(
  'oidc_authorization_codes',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    data: jsonb('data').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    consumedAt: timestamptz('consumed_at'),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: varchar('client_id', { length: 255 }).notNull(),
    grantId: varchar('grant_id', { length: 255 }),
    ...timestamps,
  },
  (t) => ({
    userIdIdx: index('oidc_authorization_codes_user_id_idx').on(t.userId),
  }),
);

/**
 * OIDC access token
 * One of the models that oidc-provider needs to persist
 */
export const oidcAccessTokens = pgTable(
  'oidc_access_tokens',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    data: jsonb('data').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    consumedAt: timestamptz('consumed_at'),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: varchar('client_id', { length: 255 }).notNull(),
    grantId: varchar('grant_id', { length: 255 }),
    ...timestamps,
  },
  (t) => ({
    userIdIdx: index('oidc_access_tokens_user_id_idx').on(t.userId),
  }),
);

/**
 * OIDC refresh token
 * One of the models that oidc-provider needs to persist
 */
export const oidcRefreshTokens = pgTable(
  'oidc_refresh_tokens',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    data: jsonb('data').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    consumedAt: timestamptz('consumed_at'),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: varchar('client_id', { length: 255 }).notNull(),
    grantId: varchar('grant_id', { length: 255 }),
    ...timestamps,
  },
  (t) => ({
    userIdIdx: index('oidc_refresh_tokens_user_id_idx').on(t.userId),
  }),
);

/**
 * OIDC device code
 * One of the models that oidc-provider needs to persist
 */
export const oidcDeviceCodes = pgTable(
  'oidc_device_codes',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    data: jsonb('data').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    consumedAt: timestamptz('consumed_at'),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    clientId: varchar('client_id', { length: 255 }).notNull(),
    grantId: varchar('grant_id', { length: 255 }),
    userCode: varchar('user_code', { length: 255 }),
    ...timestamps,
  },
  (t) => ({
    userIdIdx: index('oidc_device_codes_user_id_idx').on(t.userId),
  }),
);

/**
 * OIDC interaction session
 * One of the models that oidc-provider needs to persist
 */
export const oidcInteractions = pgTable('oidc_interactions', {
  id: varchar('id', { length: 255 }).primaryKey(),
  data: jsonb('data').notNull(),
  expiresAt: timestamptz('expires_at').notNull(),
  ...timestamps,
});

/**
 * OIDC grant record
 * One of the models that oidc-provider needs to persist
 */
export const oidcGrants = pgTable(
  'oidc_grants',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    data: jsonb('data').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    consumedAt: timestamptz('consumed_at'),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: varchar('client_id', { length: 255 }).notNull(),
    ...timestamps,
  },
  (t) => ({
    userIdIdx: index('oidc_grants_user_id_idx').on(t.userId),
  }),
);

/**
 * OIDC client configuration
 * Stores OIDC client configuration information
 */
export const oidcClients = pgTable('oidc_clients', {
  id: varchar('id', { length: 255 }).primaryKey(), // client_id
  name: text('name').notNull(),
  description: text('description'),
  clientSecret: varchar('client_secret', { length: 255 }), // Can be null for public clients
  redirectUris: text('redirect_uris').array().notNull(),
  grants: text('grants').array().notNull(),
  responseTypes: text('response_types').array().notNull(),
  scopes: text('scopes').array().notNull(),
  tokenEndpointAuthMethod: varchar('token_endpoint_auth_method', { length: 20 }),
  applicationType: varchar('application_type', { length: 20 }),
  clientUri: text('client_uri'),
  logoUri: text('logo_uri'),
  policyUri: text('policy_uri'),
  tosUri: text('tos_uri'),
  isFirstParty: boolean('is_first_party').default(false),
  ...timestamps,
});

/**
 * OIDC session
 * One of the models that oidc-provider needs to persist
 */
export const oidcSessions = pgTable(
  'oidc_sessions',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    data: jsonb('data').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    ...timestamps,
  },
  (t) => ({
    userIdIdx: index('oidc_sessions_user_id_idx').on(t.userId),
  }),
);

/**
 * OIDC authorization consent record
 * Records user authorization consent history for clients
 */
export const oidcConsents = pgTable(
  'oidc_consents',
  {
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: varchar('client_id', { length: 255 })
      .references(() => oidcClients.id, { onDelete: 'cascade' })
      .notNull(),
    scopes: text('scopes').array().notNull(),
    expiresAt: timestamptz('expires_at'),
    ...timestamps,
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.clientId] }),
  }),
);

/**
 * Generic authentication credential handoff table
 * Used to securely pass authentication credentials between different clients (desktop, browser extension, mobile, etc.)
 *
 * Workflow:
 * 1. Client generates a unique handoff ID
 * 2. Appends handoff ID as a parameter to OAuth redirect_uri
 * 3. After successful authentication, intermediate page stores credentials in this table
 * 4. Client polls this table to retrieve credentials
 * 5. Record is immediately deleted after successful retrieval
 */
export const oauthHandoffs = pgTable('oauth_handoffs', {
  /**
   * One-time unique identifier generated by the client
   * Used for client polling to claim its own credentials
   */
  id: text('id').primaryKey(),

  /**
   * Client type identifier
   * Examples: 'desktop', 'browser-extension', 'mobile-app', etc.
   */
  client: varchar('client', { length: 50 }).notNull(),

  /**
   * JSON payload for credential data
   * Flexible storage for various data required by different authentication flows
   * Currently mainly contains: { code: string; state: string }
   */
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),

  /**
   * Timestamp fields for TTL control
   * Credentials should be consumed within 5 minutes of creation, otherwise considered expired
   */
  ...timestamps,
});

// Zod schemas for validation
export const insertAuthHandoffSchema = createInsertSchema(oauthHandoffs);
export const selectAuthHandoffSchema = createSelectSchema(oauthHandoffs);

export type OAuthHandoffItem = typeof oauthHandoffs.$inferSelect;
export type NewOAuthHandoff = typeof oauthHandoffs.$inferInsert;
