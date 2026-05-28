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

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';

export interface OIDCConfig {
  scheme: 'pre_registration' | 'dcr' | 'client_id_metadata_document';

  /**
   * Client identifier.
   * - pre_registration: filled in by the user
   * - dcr: written back after dynamic registration succeeds
   * - client_id_metadata_document: this value IS the metadata URL
   */
  clientId?: string;

  /** OIDC discovery issuer URL — preferred over manual endpoint overrides */
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;

  scopes?: string[];
  redirectUri?: string;
  /** Recommended for public clients */
  usePKCE?: boolean;

  /** DCR only (RFC 7591) — dynamic client registration endpoint */
  registrationEndpoint?: string;
}

/**
 * Decrypted shape of the `credentials` column.
 * Encrypted at rest via KeyVaultsGateKeeper (same as messengerInstallations).
 */
export type ConnectorCredentials =
  | {
      type: 'oauth2';
      accessToken: string;
      refreshToken?: string;
      clientSecret?: string;
      /** DCR — token for managing the dynamic registration */
      registrationAccessToken?: string;
      expiresAt?: number;
      scope?: string;
      idToken?: string;
    }
  | { type: 'bearer'; token: string }
  | { type: 'apikey'; apiKey: string }
  | { type: 'header'; headers: Record<string, string> };

export const ConnectorSourceType = {
  builtin: 'builtin',
  custom: 'custom',
  marketplace: 'marketplace',
} as const;

export type ConnectorSourceType = (typeof ConnectorSourceType)[keyof typeof ConnectorSourceType];

export const ConnectorStatus = {
  connected: 'connected',
  disconnected: 'disconnected',
  error: 'error',
} as const;

export type ConnectorStatus = (typeof ConnectorStatus)[keyof typeof ConnectorStatus];

export const ConnectorMcpConnectionType = {
  cloud: 'cloud',
  http: 'http',
  stdio: 'stdio',
} as const;

export type ConnectorMcpConnectionType =
  (typeof ConnectorMcpConnectionType)[keyof typeof ConnectorMcpConnectionType];

/**
 * One row per user-connector connection.
 *
 * Stores MCP connection parameters and OAuth/OIDC credentials for a single
 * connector. Tool-level permission data lives in `user_connector_tools`.
 *
 * Credential values are AES-GCM encrypted via KeyVaultsGateKeeper before
 * being written to `credentials`. `tokenExpiresAt` is promoted out of the
 * encrypted blob so background token-refresh jobs can index on it without
 * decrypting every row.
 */
export const userConnectors = pgTable(
  'user_connectors',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    // ── Connector identity ────────────────────────────────────────────────
    /** Fixed slug for built-ins (e.g. "linear"); nanoid for custom ones */
    identifier: varchar('identifier', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    /** 'builtin' | 'custom' | 'marketplace' */
    sourceType: text('source_type').notNull(),

    // ── MCP connection ────────────────────────────────────────────────────
    mcpServerUrl: text('mcp_server_url'),
    /** 'http' | 'stdio' | 'cloud' */
    mcpConnectionType: text('mcp_connection_type'),
    /** stdio only: { command, args?, env? } */
    mcpStdioConfig: jsonb('mcp_stdio_config').$type<{
      args?: string[];
      command: string;
      env?: Record<string, string>;
    }>(),

    // ── Connection state ──────────────────────────────────────────────────
    /** 'connected' | 'disconnected' | 'error' */
    status: text('status').notNull(),
    isEnabled: boolean('is_enabled').notNull().default(true),

    // ── OIDC/OAuth config (plaintext — non-sensitive) ─────────────────────
    oidcConfig: jsonb('oidc_config').$type<OIDCConfig>(),

    // ── Encrypted credentials ─────────────────────────────────────────────
    credentials: text('credentials'),
    tokenExpiresAt: timestamptz('token_expires_at'),

    /** Safe non-sensitive metadata for display and future extensibility */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('user_connectors_user_identifier_unique').on(t.userId, t.identifier),
    index('user_connectors_user_id_idx').on(t.userId),
    /** Scanned by background token-refresh worker */
    index('user_connectors_token_expires_at_idx').on(t.tokenExpiresAt),
  ],
);

export type NewUserConnector = typeof userConnectors.$inferInsert;
export type UserConnectorItem = typeof userConnectors.$inferSelect;
