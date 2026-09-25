import type { AcceptanceInstallEvent } from '@lobechat/types';
import { index, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';

import { createdAt } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Acceptance install events — one row per reported CLI install or refresh
 * (`lh acceptance install` / `lh acceptance update`). Append-only adoption
 * telemetry read by the ops dashboard; the product itself never reads it.
 */
export const acceptanceInstalls = pgTable(
  'acceptance_installs',
  {
    // Rows are only ever aggregated in bulk, never addressed one at a time.
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    // Attribution is cleared on deletion without reducing historical event totals.
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),

    event: varchar('event', { length: 16 }).$type<AcceptanceInstallEvent>().notNull(),
    /** Downloaded bundle version, e.g. '0.5.0'; skipped existing files may differ. */
    version: text('version'),

    createdAt: createdAt(),
  },
  (t) => [
    // The ops dashboard's hot path: totals and time series.
    index('acceptance_installs_created_at_idx').on(t.createdAt),
    index('acceptance_installs_user_id_idx').on(t.userId),
    index('acceptance_installs_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewAcceptanceInstall = typeof acceptanceInstalls.$inferInsert;
export type AcceptanceInstallItem = typeof acceptanceInstalls.$inferSelect;
