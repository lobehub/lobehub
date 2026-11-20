import type { FileShareConfig, ShareVisibility } from '@lobechat/types';
import { index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { createNanoId } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { files } from './file';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Single-file sharing table - public read-only links for one file, independent
 * of goals. One share per file; `visibility` is share semantics ('private' =
 * owner only, 'link' = anyone with the link), not the workspace row-visibility.
 */
export const fileShares = pgTable(
  'file_shares',
  {
    id: text('id')
      .$defaultFn(() => createNanoId(16)())
      .primaryKey(),

    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),

    /** File owner; stays the share owner even when a workspace admin manages the share. */
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    pageViewCount: integer('page_view_count').default(0).notNull(),

    /** Owner-controlled share settings; see `FileShareConfig`. */
    config: jsonb('config').$type<FileShareConfig>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    visibility: text('visibility').$type<ShareVisibility>().default('private').notNull(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('file_shares_file_id_unique').on(t.fileId),
    index('file_shares_user_id_idx').on(t.userId),
    index('file_shares_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewFileShare = typeof fileShares.$inferInsert;
export type FileShareItem = typeof fileShares.$inferSelect;
