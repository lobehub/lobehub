import type { ShareVisibility } from '@lobechat/types';
import { index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { createNanoId } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { generations } from './generation';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Public read-only links for one AI generation result (image, video or music),
 * `/share/g/<id>`. One share per generation; `visibility` is share semantics
 * ('private' = owner only, 'link' = anyone with the link), not the workspace
 * row-visibility of `generation_topics`.
 */
export const generationShares = pgTable(
  'generation_shares',
  {
    id: text('id')
      .$defaultFn(() => createNanoId(12)())
      .primaryKey(),

    generationId: text('generation_id')
      .notNull()
      .references(() => generations.id, { onDelete: 'cascade' }),

    /** Generation owner; stays the share owner even when a workspace admin manages the share. */
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    pageViewCount: integer('page_view_count').default(0).notNull(),

    visibility: text('visibility').$type<ShareVisibility>().default('private').notNull(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('generation_shares_generation_id_unique').on(t.generationId),
    index('generation_shares_user_id_idx').on(t.userId),
    index('generation_shares_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewGenerationShare = typeof generationShares.$inferInsert;
export type GenerationShareItem = typeof generationShares.$inferSelect;
