import { boolean, index, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { userConnectors } from './connector';
import { users } from './user';

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

    // ── Tool definition (synced from MCP manifest) ────────────────────────
    toolName: varchar('tool_name', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 255 }),
    description: text('description'),
    /** JSON Schema describing the tool's input parameters */
    inputSchema: jsonb('input_schema'),
    /** JSON Schema describing the tool's output shape — not all servers provide this */
    outputSchema: jsonb('output_schema'),

    // ── CRUD type ─────────────────────────────────────────────────────────
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
     * - 'disabled'        — not injected; AI cannot see or call this tool
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
     * Structure: { inputAllowlist, inputLimit, outputLimit }
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
    uniqueIndex('user_connector_tools_connector_tool_unique').on(
      t.userConnectorId,
      t.toolName,
    ),
    index('user_connector_tools_user_id_idx').on(t.userId),
    index('user_connector_tools_connector_id_idx').on(t.userConnectorId),
  ],
);

export type NewUserConnectorTool = typeof userConnectorTools.$inferInsert;
export type UserConnectorToolItem = typeof userConnectorTools.$inferSelect;
