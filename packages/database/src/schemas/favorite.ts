import type { FavoriteType } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Links a member pinned to the Favorites section of their sidebar. Favorites
 * are personal even inside a workspace: `workspace_id` only scopes which
 * sidebar the row belongs to, and every read also pins `user_id`.
 *
 * The target is not a foreign key — a favorite can point at any in-app page,
 * so a deleted resource leaves a row that opens its not-found page until the
 * member removes it.
 */
export const userFavorites = pgTable(
  'user_favorites',
  {
    // Only ever sent back to the API, never shown or linked, so no id prefix.
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    type: text('type').$type<FavoriteType>().notNull(),
    /** Resource id (`tpc_…`, `docs_…`) for resource types; the path itself for `route`. */
    targetId: text('target_id').notNull(),
    /** In-app path without the workspace slug, e.g. `/agent/agt_x/tpc_y`. */
    path: text('path').notNull(),
    /** Title snapshot, refreshed by the client while the favorited page is open. */
    title: text('title').notNull(),
    /** Emoji or avatar URL snapshot; null renders the type icon. */
    icon: text('icon'),
    /** Position in the section, ascending. New favorites append to the end. */
    sortOrder: integer('sort_order').notNull().default(0),

    ...timestamps,
  },
  (t) => [
    // One favorite per target and sidebar. Split in two because a NULL
    // workspace never collides in a plain unique index.
    uniqueIndex('user_favorites_personal_target_unique')
      .on(t.userId, t.type, t.targetId)
      .where(sql`${t.workspaceId} IS NULL`),
    uniqueIndex('user_favorites_workspace_target_unique')
      .on(t.userId, t.workspaceId, t.type, t.targetId)
      .where(sql`${t.workspaceId} IS NOT NULL`),
    // Neither partial index serves a lookup by user alone, which the
    // `ON DELETE CASCADE` from users needs.
    index('user_favorites_user_id_idx').on(t.userId),
    index('user_favorites_workspace_id_idx').on(t.workspaceId),
  ],
);

export type UserFavoriteItem = typeof userFavorites.$inferSelect;
export type NewUserFavorite = typeof userFavorites.$inferInsert;
