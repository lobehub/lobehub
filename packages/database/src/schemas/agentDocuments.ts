import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt } from './_helpers';
import { agents } from './agent';
import { documents } from './file';
import { users } from './user';

/**
 * Agent document settings mapped to canonical documents rows.
 *
 * Access model (5-bit bitmask):
 * - bit4 (16): delete
 * - bit3 (8): list
 * - bit2 (4): write
 * - bit1 (2): read
 * - bit0 (1): execute
 * - full access: 31, no access: 0
 *
 * Access domains:
 * - accessSelf: owner/self channel access
 * - accessShared: shared users/agents channel access
 * - accessPublic: public channel access
 *
 * Policy load:
 * - policyLoad controls injection pipeline participation (enum-like string values).
 * - deletedAt/deletedByUserId/deletedByAgentId/deleteReason implement soft delete.
 *
 * User actions:
 * - Disable document:
 *   1) set accessSelf/accessShared/accessPublic to 0 as needed
 *   2) set policyLoad = 'disabled'
 *   3) keep deletedAt = null (still restorable as active record)
 * - Enable document:
 *   1) restore access bitmask (example: 10 => list + read)
 *   2) set policyLoad = 'always'
 *   3) ensure deletedAt = null
 * - Delete document:
 *   1) set deletedAt + one of deletedByUserId/deletedByAgentId + deleteReason
 *   2) force policyLoad = 'disabled'
 *   3) keep row for recovery/audit
 */
export const agentDocuments = pgTable(
  'agent_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    documentId: varchar('document_id', { length: 255 })
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),

    /**
     * Template source label (e.g. 'claw', 'custom').
     * Used for grouping and re-initialization workflows.
     */
    templateId: varchar('template_id', { length: 100 }),

    /**
     * Access bitmask for owner/self channel.
     *
     * Bit positions (b4 b3 b2 b1 b0):
     * - b4 (1 << 4 = 16): delete
     * - b3 (1 << 3 = 8): list
     * - b2 (1 << 2 = 4): write
     * - b1 (1 << 1 = 2): read
     * - b0 (1 << 0 = 1): execute
     *
     * Examples:
     * - 00000b = 0  => no permissions
     * - 01010b = 10 => list + read
     * - 11111b = 31 => full permissions (default)
     *
     * Shared-access profile examples:
     * - locked prompt: accessSelf=10, accessShared=10, accessPublic=0
     * - executable skill: accessSelf=31, accessShared=15, accessPublic=0
     * - public reference doc: accessSelf=31, accessShared=10, accessPublic=10
     */
    accessSelf: integer('access_self').notNull().default(31),
    /**
     * Access bitmask for shared channel (shared users/agents).
     * Same 5-bit semantics as accessSelf.
     */
    accessShared: integer('access_shared').notNull().default(0),
    /**
     * Access bitmask for public channel.
     * Same 5-bit semantics as accessSelf.
     */
    accessPublic: integer('access_public').notNull().default(0),

    /**
     * Controls whether this document participates in automatic context injection.
     * Example values: 'always', 'disabled'. Keep enum values unchanged.
     * This is independent from access bitmask values.
     */
    policyLoad: varchar('policy_load', { length: 30 }).notNull().default('always'),

    /**
     * Canonical behavior config for context/retrieval policy.
     * Keep extensible fields here.
     */
    policy: jsonb('policy').$type<Record<string, any>>(),
    /**
     * Indexed projection of policy.context.position for fast filtering/sorting.
     */
    policyLoadPosition: varchar('policy_load_position', { length: 50 })
      .notNull()
      .default('before-first-user'),
    /**
     * Indexed projection of policy.context.policyLoadFormat for rendering strategy.
     * Example values: 'raw', 'file'.
     */
    policyLoadFormat: varchar('policy_load_format', { length: 20 }).notNull().default('raw'),
    /**
     * Indexed projection of policy.context.rule for fast filtering.
     */
    policyLoadRule: varchar('policy_load_rule', { length: 50 }).notNull().default('always'),

    /**
     * Soft delete timestamp. Non-null means logically deleted.
     */
    deletedAt: timestamptz('deleted_at'),
    /**
     * User actor who performed soft delete.
     */
    deletedByUserId: text('deleted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /**
     * Agent actor who performed soft delete.
     */
    deletedByAgentId: text('deleted_by_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    /**
     * Optional operator-supplied reason for deletion.
     */
    deleteReason: text('delete_reason'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('agent_documents_user_id_idx').on(table.userId),
    index('agent_documents_agent_id_idx').on(table.agentId),
    index('agent_documents_access_self_idx').on(table.accessSelf),
    index('agent_documents_access_shared_idx').on(table.accessShared),
    index('agent_documents_access_public_idx').on(table.accessPublic),
    index('agent_documents_policy_load_idx').on(table.policyLoad),
    index('agent_documents_template_id_idx').on(table.templateId),
    index('agent_documents_policy_load_position_idx').on(table.policyLoadPosition),
    index('agent_documents_policy_load_format_idx').on(table.policyLoadFormat),
    index('agent_documents_policy_load_rule_idx').on(table.policyLoadRule),
    index('agent_documents_agent_load_position_idx').on(table.agentId, table.policyLoadPosition),
    index('agent_documents_deleted_at_idx').on(table.deletedAt),
    index('agent_documents_agent_autoload_deleted_idx').on(
      table.agentId,
      table.deletedAt,
      table.policyLoad,
    ),
    index('agent_documents_document_id_idx').on(table.documentId),
    uniqueIndex('agent_documents_agent_document_user_unique').on(
      table.agentId,
      table.documentId,
      table.userId,
    ),
  ],
);

export type AgentDocument = typeof agentDocuments.$inferSelect;
export type NewAgentDocument = typeof agentDocuments.$inferInsert;
