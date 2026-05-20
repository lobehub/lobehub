import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './user';

// ─── Feature Flags ───────────────────────────────────────────────────────────

export const featureFlags = pgTable(
  'feature_flags',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Flag identifier, e.g. "enable_audio_generation" */
    key: text('key').notNull(),
    /** Human-readable label */
    label: text('label').notNull(),
    /** Default value when no user override exists */
    defaultEnabled: boolean('default_enabled').notNull().default(false),
    /** Per-user enabled overrides (JSON array of user IDs) */
    enabledUserIds: jsonb('enabled_user_ids').$type<string[]>().default([]),
    /** Per-user disabled overrides (JSON array of user IDs) */
    disabledUserIds: jsonb('disabled_user_ids').$type<string[]>().default([]),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('feature_flags_key_idx').on(t.key)],
);

export type NewFeatureFlag = typeof featureFlags.$inferInsert;
export type FeatureFlagItem = typeof featureFlags.$inferSelect;

// ─── Audit Logs ──────────────────────────────────────────────────────────────

export const adminAuditLogs = pgTable(
  'admin_audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Admin performing the action */
    adminId: text('admin_id')
      .references(() => users.id, { onDelete: 'set null' })
      .notNull(),
    adminEmail: text('admin_email'),
    /** Action type, e.g. "user.ban", "user.role_update", "flag.update" */
    action: text('action').notNull(),
    /** Target resource type */
    targetType: text('target_type'),
    /** Target resource identifier */
    targetId: text('target_id'),
    /** Snapshot of the change (before/after) */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    /** Client IP (optional, for audit trails) */
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('audit_logs_admin_id_idx').on(t.adminId),
    index('audit_logs_action_idx').on(t.action),
    index('audit_logs_created_at_idx').on(t.createdAt),
    index('audit_logs_target_id_idx').on(t.targetId),
  ],
);

export type NewAdminAuditLog = typeof adminAuditLogs.$inferInsert;
export type AdminAuditLogItem = typeof adminAuditLogs.$inferSelect;

// ─── Admin API Keys ───────────────────────────────────────────────────────────

export const adminApiKeys = pgTable(
  'admin_api_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Service name, e.g. "audio_generation", "image_generation" */
    service: text('service').notNull().unique(),
    /** Encrypted or masked API key value */
    keyValue: text('key_value').notNull(),
    /** Human-readable label */
    label: text('label').notNull(),
    /** Whether this key is currently active */
    isActive: boolean('is_active').notNull().default(true),
    /** Extra config (endpoint URLs, model overrides, etc.) */
    config: jsonb('config').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('admin_api_keys_service_idx').on(t.service)],
);

export type NewAdminApiKey = typeof adminApiKeys.$inferInsert;
export type AdminApiKeyItem = typeof adminApiKeys.$inferSelect;
