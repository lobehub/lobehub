import type { SkillInstallEvent } from '@lobechat/types';
import { index, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';

import { createdAt } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Skill install events — one row per completed CLI skill install
 * (`lh acceptance install` / `lh acceptance update`). Append-only adoption
 * telemetry read by the ops dashboard; the product itself never reads it.
 */
export const skillInstalls = pgTable(
  'skill_installs',
  {
    // Rows are only ever aggregated in bulk, never addressed one at a time.
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    // Attribution is cleared on deletion without reducing historical event totals.
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),

    // ── What was installed ──
    /** Pullable skill identifier, e.g. 'acceptance'. */
    identifier: text('identifier').notNull(),
    event: varchar('event', { length: 16 }).$type<SkillInstallEvent>().notNull(),
    /** Installed skill version from the SKILL.md frontmatter, e.g. '0.5.0'. */
    version: text('version'),

    createdAt: createdAt(),
  },
  (t) => [
    // The ops dashboard's hot path: totals and time series per skill.
    index('skill_installs_identifier_created_at_idx').on(t.identifier, t.createdAt),
    index('skill_installs_user_id_idx').on(t.userId),
    index('skill_installs_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewSkillInstall = typeof skillInstalls.$inferInsert;
export type SkillInstallItem = typeof skillInstalls.$inferSelect;
