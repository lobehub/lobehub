import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { environments } from './environment';
import { projects } from './project';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Project-local selection of a shared environment. This relation grants no
 * additional resource permissions. Writers must validate both resource scopes.
 */
export const projectEnvironments = pgTable(
  'project_environments',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    projectId: text('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    /** Unlink projects explicitly before deleting an environment. */
    environmentId: uuid('environment_id')
      .references(() => environments.id, { onDelete: 'restrict' })
      .notNull(),
    /** Derived from the project, never accepted as an independent authorization scope. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    addedByUserId: text('added_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    enabled: boolean('enabled').notNull().default(true),
    isDefault: boolean('is_default').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('project_environments_project_environment_unique').on(t.projectId, t.environmentId),
    uniqueIndex('project_environments_project_default_unique')
      .on(t.projectId)
      .where(sql`${t.isDefault} = true`),
    index('project_environments_project_sort_order_idx').on(t.projectId, t.sortOrder),
    index('project_environments_environment_id_idx').on(t.environmentId),
    index('project_environments_workspace_id_idx').on(t.workspaceId),
    index('project_environments_added_by_user_id_idx').on(t.addedByUserId),
    check('project_environments_default_enabled', sql`NOT ${t.isDefault} OR ${t.enabled}`),
  ],
);

export type NewProjectEnvironment = typeof projectEnvironments.$inferInsert;
export type ProjectEnvironmentItem = typeof projectEnvironments.$inferSelect;
