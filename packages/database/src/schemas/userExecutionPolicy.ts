import { boolean, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { createdAt, updatedAt } from './_helpers';
import { users } from './user';

/**
 * User-level execution policy: fine-grained read/write-path and network
 * controls for the surfaces that run a shell command directly on a machine
 * (local desktop bare execution, the desktop Local Sandbox, and an `lh
 * connect`-linked device) — all routed through the SRT engine's
 * `SandboxPolicy` (see `packages/device-sandbox/src/types.ts`).
 *
 * Deliberately separate from `commandGovernance.ts`: that table is a command
 * text blacklist for the cloud sandbox (a one-shot, already-isolated
 * environment where the AIO API accepts no policy parameters), this one is a
 * per-user filesystem/network allowlist for surfaces that share the host.
 *
 * One row per user (unique `userId`) — a policy, not a list of rules.
 * No row for a user = unrestricted, same fail-open posture as
 * `command_governance_rules`; see `getUserExecutionPolicy` in
 * `apps/server/src/services/governance/executionPolicy.ts`.
 */

/**
 * `auto` leaves the existing per-device/per-run negotiation
 * (`decideSandbox`) in charge; `host`/`sandbox` force every run on this
 * user's surfaces to skip or use the Local Sandbox respectively. Defaults to
 * `sandbox` — a policy row existing at all is the admin opting this user into
 * being fenced, so the default must not let a run quietly skip it.
 */
export const userExecutionPolicyCommandModes = ['auto', 'host', 'sandbox'] as const;
export type UserExecutionPolicyCommandMode = (typeof userExecutionPolicyCommandModes)[number];

export const userExecutionPolicies = pgTable('user_execution_policies', {
  id: uuid('id').defaultRandom().primaryKey().notNull(),

  userId: text('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),

  enabled: boolean('enabled').default(true).notNull(),

  // Filesystem — field names mirror `SandboxPolicy` 1:1 so the server can
  // pass a fetched row straight through without a translation layer.
  writableRoots: jsonb('writable_roots').$type<string[]>().notNull().default([]),
  readableRoots: jsonb('readable_roots').$type<string[]>(),
  deniedWriteRoots: jsonb('denied_write_roots').$type<string[]>(),
  deniedReadRoots: jsonb('denied_read_roots').$type<string[]>(),

  // Network
  allowNetwork: boolean('allow_network').default(false).notNull(),
  allowedNetworkDomains: jsonb('allowed_network_domains').$type<string[]>(),

  // Other
  envAllowlist: jsonb('env_allowlist').$type<string[]>(),
  commandMode: text('command_mode', { enum: userExecutionPolicyCommandModes })
    .notNull()
    .default('sandbox'),

  /** Admin identifier that created/last edited the policy (opaque to this table). */
  createdBy: text('created_by'),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type UserExecutionPolicyItem = typeof userExecutionPolicies.$inferSelect;
export type NewUserExecutionPolicy = typeof userExecutionPolicies.$inferInsert;
