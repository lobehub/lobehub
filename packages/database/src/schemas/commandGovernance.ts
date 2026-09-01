import { boolean, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { createdAt, updatedAt } from './_helpers';
import { users } from './user';

/**
 * Command governance: lets an admin restrict which shell commands a user may
 * run when an agent dispatches a command-execution tool (local desktop,
 * a remote device connected via `lh connect`, or a cloud sandbox).
 *
 * Gated end-to-end by `COMMAND_GOVERNANCE_ENABLED` (see
 * `apps/server/src/services/governance/policyGate.ts`) — when the flag is off,
 * these tables are never read or written by the tool-execution chokepoint.
 */

/** How a rule's `pattern` is matched against the command text. */
export const commandGovernancePatternTypes = ['exact', 'prefix', 'regex'] as const;
export type CommandGovernancePatternType = (typeof commandGovernancePatternTypes)[number];

/**
 * Which execution surface a rule applies to. `all` matches every target;
 * `local` is reserved for a future chokepoint that can tell a user's own
 * paired desktop apart from another `lh connect`-linked device — today both
 * route through the same device-proxy tool and are tagged `device` (see the
 * `resolveCommandExecutionTarget` comment in `builtin.ts`).
 */
export const commandGovernanceScopes = ['all', 'local', 'device', 'sandbox'] as const;
export type CommandGovernanceScope = (typeof commandGovernanceScopes)[number];

/**
 * Rule action. Only `deny` exists today (an allowlist/`warn` mode is a
 * plausible follow-up) — stored as free text rather than a DB enum so adding
 * one doesn't require a migration.
 */
export const commandGovernanceRules = pgTable(
  'command_governance_rules',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    pattern: text('pattern').notNull(),
    patternType: text('pattern_type', { enum: commandGovernancePatternTypes }).notNull(),
    scope: text('scope', { enum: commandGovernanceScopes }).notNull().default('all'),
    /** Currently only 'deny'; free text to allow future actions without a migration. */
    action: text('action').notNull().default('deny'),

    enabled: boolean('enabled').default(true).notNull(),

    /** Admin identifier that created the rule (opaque to this table). */
    createdBy: text('created_by'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('command_governance_rules_user_id_idx').on(t.userId),
    index('command_governance_rules_user_id_enabled_idx').on(t.userId, t.enabled),
  ],
);

export type CommandGovernanceRuleItem = typeof commandGovernanceRules.$inferSelect;
export type NewCommandGovernanceRule = typeof commandGovernanceRules.$inferInsert;

/** Where a governed command actually ran. Mirrors `CommandExecutionTarget`. */
export const commandExecutionTargets = ['local', 'device', 'sandbox'] as const;
export type CommandExecutionTargetDB = (typeof commandExecutionTargets)[number];

/**
 * One row per governed command-execution tool call — an audit trail of every
 * command a user's agent attempted to run, whether it was allowed or blocked.
 */
export const commandExecutionLogs = pgTable(
  'command_execution_logs',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    executionTarget: text('execution_target', { enum: commandExecutionTargets }).notNull(),
    deviceId: text('device_id'),

    toolIdentifier: text('tool_identifier').notNull(),
    apiName: text('api_name').notNull(),
    commandText: text('command_text').notNull(),

    blocked: boolean('blocked').notNull(),
    matchedRuleId: uuid('matched_rule_id').references(() => commandGovernanceRules.id, {
      onDelete: 'set null',
    }),

    /** Null when the command was blocked before it ever ran. */
    success: boolean('success'),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms'),

    createdAt: createdAt(),
  },
  (t) => [
    index('command_execution_logs_user_id_idx').on(t.userId),
    index('command_execution_logs_created_at_idx').on(t.createdAt),
    index('command_execution_logs_execution_target_idx').on(t.executionTarget),
    index('command_execution_logs_blocked_idx').on(t.blocked),
  ],
);

export type CommandExecutionLogItem = typeof commandExecutionLogs.$inferSelect;
export type NewCommandExecutionLog = typeof commandExecutionLogs.$inferInsert;
