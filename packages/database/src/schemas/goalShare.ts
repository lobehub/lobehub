import type { GoalShareConfig, ShareVisibility } from '@lobechat/types';
import { index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { createNanoId } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { goals } from './goal';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Goal sharing table - public read-only links for a finished goal's wrap-up.
 * One share per goal; `visibility` is share semantics ('private' = owner only,
 * 'link' = anyone with the link), not the workspace row-visibility.
 */
export const goalShares = pgTable(
  'goal_shares',
  {
    id: text('id')
      .$defaultFn(() => createNanoId(16)())
      .primaryKey(),

    goalId: text('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),

    /** Goal creator; stays the share owner even when a workspace admin manages the share. */
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    pageViewCount: integer('page_view_count').default(0).notNull(),

    /** Owner-controlled share settings; see `GoalShareConfig`. */
    config: jsonb('config').$type<GoalShareConfig>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    visibility: text('visibility').$type<ShareVisibility>().default('private').notNull(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('goal_shares_goal_id_unique').on(t.goalId),
    index('goal_shares_user_id_idx').on(t.userId),
    index('goal_shares_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewGoalShare = typeof goalShares.$inferInsert;
export type GoalShareItem = typeof goalShares.$inferSelect;
