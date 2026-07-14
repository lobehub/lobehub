import type { CustomPluginParams, ToolManifest } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps, timestamptz, varchar255 } from './_helpers';
import { agents } from './agent';
import { users } from './user';
import { workspaces } from './workspace';

// ─────────────────────────────────────────────────────────────────────────────
// user_connectors — types & consts
// ─────────────────────────────────────────────────────────────────────────────

export interface OIDCConfig {
  authorizationEndpoint?: string;

  /**
   * Client identifier.
   * - pre_registration: filled in by the user
   * - dcr: written back after dynamic registration succeeds
   * - client_id_metadata_document: this value IS the metadata URL
   */
  clientId?: string;

  /**
   * Client secret for confidential clients.
   * - pre_registration: filled in by the user
   * - dcr: written back after dynamic registration succeeds
   * Stored in plaintext (non-token credential); access/refresh tokens live
   * encrypted in `credentials` instead.
   */
  clientSecret?: string;

  /** OIDC discovery issuer URL — preferred over manual endpoint overrides */
  issuer?: string;
  redirectUri?: string;
  /** DCR only (RFC 7591) — dynamic client registration endpoint */
  registrationEndpoint?: string;

  scheme: 'pre_registration' | 'dcr' | 'client_id_metadata_document';
  scopes?: string[];
  tokenEndpoint?: string;

  /** Recommended for public clients */
  usePKCE?: boolean;
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
 * Composio runtime config carried on `user_connectors.metadata.composio`.
 *
 * This is the source of truth for running a Composio connector at runtime
 * (manifest building + tool execution), replacing the reverse lookup into
 * `user_installed_plugins.customParams.composio`. `connectedAccountId` is the
 * only field strictly required to execute a tool; the rest support connection
 * management and list display.
 */
export interface ComposioConnectorMetadata {
  appSlug: string;
  authConfigId: string;
  connectedAccountId: string;
  redirectUrl?: string;
  /** 'PENDING' | 'ACTIVE' | 'FAILED' — Composio-side connection status */
  status: string;
}

/**
 * Typed shape of the `metadata` column. Keeps an index signature so existing
 * ad-hoc keys (e.g. `customHeaders`) and future extensions stay valid.
 */
export interface ConnectorMetadata {
  [key: string]: unknown;
  avatar?: string;
  composio?: ComposioConnectorMetadata;
  customHeaders?: Record<string, string>;
  description?: string;
  /**
   * "Mount" reference lock: a base (user-owned) connector referenced by an
   * agent via the "挂载/Linked" flow. The row stays user-owned (`agent_id`
   * NULL) and keeps syncing with the user's edits, but resolves for this agent
   * and is locked so no other agent can mount the same connector. Cleared on
   * unmount. Distinct from `agent_id` (which is full agent ownership — Copy /
   * Connect-new).
   */
  mountedByAgentId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// user_connectors
// ─────────────────────────────────────────────────────────────────────────────

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
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /**
     * Agent-scoped connector. When set, this connector belongs to a specific
     * agent and takes priority over the workspace/personal connector of the
     * same identifier at resolution time (Agent > Workspace > Personal). Null
     * for personal/workspace connectors. Composio agent-specific accounts live
     * on this row's `metadata`, so the whole agent dimension stays on this
     * table (no `agent_id` on `user_installed_plugins`).
     */
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'cascade' }),

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
    metadata: jsonb('metadata').$type<ConnectorMetadata>(),

    ...timestamps,
  },
  (t) => [
    index('user_connectors_personal_identifier_idx')
      .on(t.userId, t.identifier)
      .where(sql`${t.workspaceId} IS NULL AND ${t.agentId} IS NULL`),
    index('user_connectors_workspace_identifier_idx')
      .on(t.userId, t.workspaceId, t.identifier)
      .where(sql`${t.workspaceId} IS NOT NULL AND ${t.agentId} IS NULL`),
    index('user_connectors_agent_identifier_idx')
      .on(t.agentId, t.identifier)
      .where(sql`${t.agentId} IS NOT NULL`),
    index('user_connectors_user_id_idx').on(t.userId),
    /** Scanned by background token-refresh worker */
    index('user_connectors_token_expires_at_idx').on(t.tokenExpiresAt),
    index('user_connectors_workspace_id_idx').on(t.workspaceId),
    index('user_connectors_agent_id_idx').on(t.agentId),
  ],
);

export type NewUserConnector = typeof userConnectors.$inferInsert;
export type UserConnectorItem = typeof userConnectors.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// user_connector_tools — types & consts
// ─────────────────────────────────────────────────────────────────────────────

export const ToolCRUDType = {
  delete: 'delete',
  read: 'read',
  update: 'update',
  write: 'write',
} as const;

export type ToolCRUDType = (typeof ToolCRUDType)[keyof typeof ToolCRUDType];

export const ConnectorToolPermission = {
  auto: 'auto',
  disabled: 'disabled',
  needs_approval: 'needs_approval',
} as const;

export type ConnectorToolPermission =
  (typeof ConnectorToolPermission)[keyof typeof ConnectorToolPermission];

// ─────────────────────────────────────────────────────────────────────────────
// user_connector_tools
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete tool list for a user's connector — the single source of truth.
 *
 * Rows are batch-upserted when a connector is connected or its manifest is
 * refreshed. On upsert, only manifest-derived fields (displayName, description,
 * inputSchema, outputSchema, crudType, renderConfig) are overwritten;
 * user-controlled fields (permission, isWorkArtifact, workArtifactConfig,
 * limitConfig) are never overwritten so that user preferences survive
 * manifest refreshes.
 *
 * `userId` is denormalised from `userConnectors` to avoid a join on the
 * hot path that builds the tool list for an agent session.
 */
export const userConnectorTools = pgTable(
  'user_connector_tools',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    userConnectorId: uuid('user_connector_id')
      .references(() => userConnectors.id, { onDelete: 'cascade' })
      .notNull(),

    /** Denormalised for query performance — avoids join when listing tools */
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    // ── Tool definition (synced from MCP manifest) ────────────────────────
    toolName: varchar('tool_name', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 255 }),
    description: text('description'),
    /** JSON Schema describing the tool's input parameters */
    inputSchema: jsonb('input_schema'),
    /** JSON Schema describing the tool's output shape — not all servers provide this */
    outputSchema: jsonb('output_schema'),

    // ── CRUD type (synced from manifest) ─────────────────────────────────
    /** Operation type: 'read' | 'write' | 'update' | 'delete' */
    crudType: text('crud_type').notNull(),

    // ── Render config (synced from manifest) ─────────────────────────────
    /**
     * UI rendering configuration for this tool.
     * e.g. { streaming: true, expandDuringStreaming: true, render: {...} }
     * Supports future dynamic render injection.
     */
    renderConfig: jsonb('render_config').$type<Record<string, unknown>>(),

    // ── Permission control (user-configured) ──────────────────────────────
    /**
     * Three-state permission:
     * - 'auto'            — allow AI to call without confirmation
     * - 'needs_approval'  — require human approval before execution
     * - 'disabled'        — injected with blocking description; AI knows it is disabled and cannot call it
     */
    permission: text('permission').notNull(),

    // ── Work artifact (user-configured) ───────────────────────────────────
    /** Whether this tool's output is considered a persistent work artifact */
    isWorkArtifact: boolean('is_work_artifact').notNull().default(false),
    /**
     * Work artifact configuration for tools that produce persistent records.
     * e.g. local file reads need no record; document creation stores
     * { type: 'document', ... } so downstream can link the artifact.
     */
    workArtifactConfig: jsonb('work_artifact_config').$type<Record<string, unknown>>(),

    // ── Limit config (user-configured) ────────────────────────────────────
    /**
     * Parameter-level input/output constraints.
     * e.g. {
     *   inputAllowlist: { command: ["ls", "cat", "grep"] },
     *   inputLimit: { path: { deny: ["/etc/**"] } },
     *   outputLimit: { maxLength: 10000, errorPatterns: ["secret:"] }
     * }
     */
    limitConfig: jsonb('limit_config').$type<Record<string, unknown>>(),

    /** Safe non-sensitive metadata for display and future extensibility */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    ...timestamps,
  },
  (t) => [
    /** One permission row per (connector, tool) */
    uniqueIndex('user_connector_tools_connector_tool_unique').on(t.userConnectorId, t.toolName),
    index('user_connector_tools_user_id_idx').on(t.userId),
    index('user_connector_tools_connector_id_idx').on(t.userConnectorId),
    index('user_connector_tools_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewUserConnectorTool = typeof userConnectorTools.$inferInsert;
export type UserConnectorToolItem = typeof userConnectorTools.$inferSelect;

// Deprecated legacy plugin install table. Keep workspaceId only for old rows;
// workspace audits should ignore this table instead of expanding constraints.
export const userInstalledPlugins = pgTable(
  'user_installed_plugins',
  {
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    identifier: text('identifier').notNull(),
    type: text('type', { enum: ['plugin', 'customPlugin'] }).notNull(),
    manifest: jsonb('manifest').$type<ToolManifest>(),
    settings: jsonb('settings'),
    customParams: jsonb('custom_params').$type<CustomPluginParams>(),
    source: varchar255('source'),
    ...timestamps,
  },
  (self) => ({
    id: primaryKey({ columns: [self.userId, self.identifier] }),
    workspaceIdIdx: index('user_installed_plugins_workspace_id_idx').on(self.workspaceId),
  }),
);

export type NewInstalledPlugin = typeof userInstalledPlugins.$inferInsert;
export type InstalledPluginItem = typeof userInstalledPlugins.$inferSelect;
