import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, timestamps } from './_helpers';
import { tasks } from './task';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Task labels — a workspace-level (or, in personal mode, per-user) label
 * registry modelled on Linear's issue labels. Every workspace member shares
 * the same label set; `workspace_id IS NULL` rows belong to a single user.
 *
 * Labels can be grouped one level deep: a row with `is_group = true` is a
 * group (it can never be attached to a task), and its children point at it
 * through `parent_id`. A task carries at most one label from each group —
 * the model enforces that when attaching (picking a sibling replaces the
 * previous one), the same way Linear treats "Type: Bug / Feature".
 */
export const taskLabels = pgTable(
  'task_labels',
  {
    id: uuid('id').defaultRandom().notNull().primaryKey(),
    /**
     * Creator. Workspace labels outlive their creator (the user delete only
     * clears this, like workspace channels); personal labels are deleted
     * explicitly in `UserModel.deleteUser`.
     */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** Group this label belongs to; deleting the group deletes its labels. */
    parentId: uuid('parent_id'),
    isGroup: boolean('is_group').default(false).notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** Display color as a CSS hex value, e.g. `#F5A623` (validated at the router). */
    color: text('color'),
    sortOrder: integer('sort_order').default(0).notNull(),

    ...timestamps,
  },
  (t) => [
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: 'task_labels_parent_id_task_labels_id_fk',
    }).onDelete('cascade'),
    index('task_labels_user_id_idx').on(t.userId),
    index('task_labels_workspace_id_idx').on(t.workspaceId),
    index('task_labels_parent_id_idx').on(t.parentId),
    // Names are what the CLI and agent tools address labels by, so they are
    // unique per scope (case-insensitively), groups included — `--label Bug`
    // must resolve to exactly one row. Split in two because the scope key
    // differs: personal rows key on the owner, workspace rows on the workspace.
    uniqueIndex('task_labels_user_id_name_unique')
      .on(t.userId, sql`lower(${t.name})`)
      .where(sql`${t.workspaceId} IS NULL`),
    uniqueIndex('task_labels_workspace_id_name_unique')
      .on(t.workspaceId, sql`lower(${t.name})`)
      .where(sql`${t.workspaceId} IS NOT NULL`),
  ],
);

export type NewTaskLabel = typeof taskLabels.$inferInsert;
export type TaskLabelItem = typeof taskLabels.$inferSelect;

/**
 * Task ↔ label assignments. Rows are only read in bulk for a task (or a
 * label), always joined back through `tasks` under the task ownership
 * predicate, so they carry no visibility mirror of their own: a link to a
 * task the caller cannot see is unreachable by construction.
 */
export const taskLabelLinks = pgTable(
  'task_label_links',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    taskId: text('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    labelId: uuid('label_id')
      .references(() => taskLabels.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('task_label_links_task_id_label_id_unique').on(t.taskId, t.labelId),
    index('task_label_links_label_id_idx').on(t.labelId),
    index('task_label_links_user_id_idx').on(t.userId),
    index('task_label_links_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewTaskLabelLink = typeof taskLabelLinks.$inferInsert;
export type TaskLabelLinkItem = typeof taskLabelLinks.$inferSelect;
