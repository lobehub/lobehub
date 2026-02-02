/* eslint-disable sort-keys-fix/sort-keys-fix  */
import { index, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';

/**
 * MCP OAuth pending authorization state.
 * Single-use, bound to userId, 10 min TTL. Deleted after use or on expiry.
 */
export const mcpOauthPending = pgTable(
  'mcp_oauth_pending',
  {
    state: text('state').primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    pluginIdentifier: text('plugin_identifier').notNull(),
    mcpUrl: text('mcp_url').notNull(),
    codeVerifier: text('code_verifier').notNull(),
    redirectUri: text('redirect_uri').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    clientId: text('client_id'),
    tokenEndpoint: text('token_endpoint').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    ...timestamps,
  },
  (t) => [index('mcp_oauth_pending_user_id_expires_at_idx').on(t.userId, t.expiresAt)],
);

/**
 * MCP OAuth tokens per user + plugin.
 * access_token and refresh_token stored encrypted at rest (encryption in service layer).
 */
export const mcpOauthTokens = pgTable(
  'mcp_oauth_tokens',
  {
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    pluginIdentifier: text('plugin_identifier').notNull(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token'),
    expiresAt: timestamptz('expires_at'),
    tokenEndpoint: text('token_endpoint').notNull(),
    clientId: text('client_id').notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.pluginIdentifier] }),
    index('mcp_oauth_tokens_user_id_idx').on(t.userId),
  ],
);

export type McpOauthPendingItem = typeof mcpOauthPending.$inferSelect;
export type NewMcpOauthPendingItem = typeof mcpOauthPending.$inferInsert;
export type McpOauthTokensItem = typeof mcpOauthTokens.$inferSelect;
export type NewMcpOauthTokensItem = typeof mcpOauthTokens.$inferInsert;
