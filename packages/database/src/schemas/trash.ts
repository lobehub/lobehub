import type { TrashItemMeta, TrashResourceType } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, timestamptz } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Recycle-bin registry.
 *
 * Soft delete in LobeHub is a two-part contract:
 *
 * 1. The source table carries `is_deleted` + `deleted_at` (see
 *    `_helpers.softDeleteColumns()`); every ownership-scoped read filters
 *    `is_deleted IS NOT TRUE`, so a trashed row is invisible in place. The row —
 *    and everything hanging off it through FK cascades — stays in the
 *    database untouched, which is what makes restore a single `UPDATE`.
 * 2. This table is the *index* over those trashed rows. It answers "what is in
 *    my recycle bin" without a UNION across a dozen tables, carries the
 *    denormalised title / meta so the list renders without joins, and owns
 *    the expiry clock the purge sweep runs on.
 *
 * `root_id` models cascades. When a user trashes an agent, the agent row is
 * the root and every topic stamped along with it is registered as a child
 * pointing at that root. The UI lists roots only; restore / purge operate on
 * a root and pull its children along. Children that were trashed *before* the
 * root (a topic deleted last week, its agent deleted today) keep their own
 * root row and stay in the bin after the agent is restored.
 *
 * `resource_id` is a polymorphic reference with no FK: purge (or a hard delete
 * through a non-trash path) is expected to remove the matching rows here, and
 * the sweep prunes any that slipped through.
 */
export const trashItems = pgTable(
  'trash_items',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    resourceType: text('resource_type').$type<TrashResourceType>().notNull(),
    resourceId: text('resource_id').notNull(),

    /** Denormalised display title captured at trash time. */
    title: text('title'),
    meta: jsonb('meta').$type<TrashItemMeta>(),

    /**
     * Cascade root. NULL for the row the user actually deleted; set for rows
     * stamped along with it. Cascades on the root so purging the root drops
     * its children's registry rows in one statement.
     */
    rootId: uuid('root_id').references((): any => trashItems.id, { onDelete: 'cascade' }),

    /**
     * Owner scope — same compat semantics as content tables: personal mode is
     * `user_id = ? AND workspace_id IS NULL`, team mode is `workspace_id = ?`.
     */
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** Actor who pressed delete. Differs from `user_id` for a workspace owner tidying a member's rows. */
    deletedByUserId: text('deleted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    deletedAt: timestamptz('deleted_at').notNull().defaultNow(),
    /** After this instant the purge sweep may hard-delete the root and its cascade. */
    expiresAt: timestamptz('expires_at').notNull(),

    createdAt: createdAt(),
  },
  (t) => [
    // One registry row per trashed resource — the arbiter for "trash twice".
    uniqueIndex('trash_items_resource_unique').on(t.resourceType, t.resourceId),
    // Recycle bin listing: newest first within a scope, roots only. Personal
    // mode filters `user_id = ? AND workspace_id IS NULL`, team mode filters
    // `workspace_id = ?` alone — so each gets an index led by its own key.
    index('trash_items_personal_listing_idx')
      .on(t.userId, t.deletedAt)
      .where(sql`${t.rootId} IS NULL AND ${t.workspaceId} IS NULL`),
    index('trash_items_workspace_listing_idx')
      .on(t.workspaceId, t.deletedAt)
      .where(sql`${t.rootId} IS NULL AND ${t.workspaceId} IS NOT NULL`),
    // Purge sweep: expired roots.
    index('trash_items_expires_at_idx')
      .on(t.expiresAt)
      .where(sql`${t.rootId} IS NULL`),
    index('trash_items_root_id_idx').on(t.rootId),
  ],
);

export type TrashItemRow = typeof trashItems.$inferSelect;
export type NewTrashItemRow = typeof trashItems.$inferInsert;
