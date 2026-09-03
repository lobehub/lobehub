import { index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { projects } from './project';
import { users } from './user';
import { works } from './work';
import { workspaces } from './workspace';

/** Durable outputs associated with a project; one Work may participate in multiple projects. */
export const projectWorks = pgTable(
  'project_works',
  {
    id: uuid('id').defaultRandom().notNull().primaryKey(),
    projectId: text('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    workId: text('work_id')
      .references(() => works.id, { onDelete: 'cascade' })
      .notNull(),
    addedByUserId: text('added_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('project_works_project_id_work_id_unique').on(t.projectId, t.workId),
    index('project_works_project_id_sort_order_idx').on(t.projectId, t.sortOrder),
    index('project_works_work_id_idx').on(t.workId),
    index('project_works_workspace_id_idx').on(t.workspaceId),
  ],
);
