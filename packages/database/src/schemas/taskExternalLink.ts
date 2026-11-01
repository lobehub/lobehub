import type { LinearIssueLinkMetadata, TaskExternalProvider } from '@lobechat/types';
import { isNotNull, isNull } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { timestamps, timestamptz, varchar255 } from './_helpers';
import { tasks } from './task';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * A task imported from an item in another tool (a Linear issue). The link is
 * what lets a later sync update that task instead of creating another one:
 * within a scope an external item maps to at most one task.
 *
 * Syncing is one way, so the external item is never changed from here.
 */
export const taskExternalLinks = pgTable(
  'task_external_links',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    taskId: text('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),

    /** Who imported it. */
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    provider: text('provider').$type<TaskExternalProvider>().notNull(),
    /** The provider's stable id (a Linear issue UUID). */
    externalId: varchar255('external_id').notNull(),
    /** Human-readable key, e.g. `ENG-123`. */
    externalIdentifier: varchar255('external_identifier').notNull(),
    externalUrl: text('external_url').notNull(),
    /** Container the item lives in (a Linear team id), to find links a filtered sync missed. */
    externalContainerId: varchar255('external_container_id'),
    externalUpdatedAt: timestamptz('external_updated_at'),
    /**
     * Hash of the task fields the last sync wrote. A task whose current fields
     * no longer match was edited in LobeHub, and the next sync keeps the edit.
     */
    syncedHash: text('synced_hash').notNull(),
    lastSyncedAt: timestamptz('last_synced_at').notNull().defaultNow(),
    metadata: jsonb('metadata').$type<LinearIssueLinkMetadata>().default({}).notNull(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('task_external_links_task_id_unique').on(t.taskId),
    uniqueIndex('task_external_links_personal_unique')
      .on(t.userId, t.provider, t.externalId)
      .where(isNull(t.workspaceId)),
    uniqueIndex('task_external_links_workspace_unique')
      .on(t.workspaceId, t.provider, t.externalId)
      .where(isNotNull(t.workspaceId)),
    index('task_external_links_container_idx').on(t.provider, t.externalContainerId),
    index('task_external_links_user_id_idx').on(t.userId),
  ],
);

export type NewTaskExternalLink = typeof taskExternalLinks.$inferInsert;
export type TaskExternalLinkItem = typeof taskExternalLinks.$inferSelect;
