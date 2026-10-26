import type { ProjectMemberRole } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { projects } from './project';
import { users } from './user';
import { acceptances } from './verify';
import { workspaces } from './workspace';

export const projectSites = pgTable(
  'project_sites',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('projectSites'))
      .notNull(),
    projectId: text('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    name: varchar('name', { length: 255 }).notNull(),
    origins: text('origins').array().notNull(),
    acceptanceId: uuid('acceptance_id').references(() => acceptances.id, { onDelete: 'set null' }),

    ...timestamps,
  },
  (t) => [
    index('project_sites_project_id_idx').on(t.projectId),
    index('project_sites_workspace_id_idx').on(t.workspaceId),
    check('project_sites_name_not_empty', sql`length(btrim(${t.name})) > 0`),
    check('project_sites_origins_not_empty', sql`cardinality(${t.origins}) > 0`),
  ],
);

export type NewProjectSite = typeof projectSites.$inferInsert;
export type ProjectSiteItem = typeof projectSites.$inferSelect;

/**
 * Role overrides for existing workspace members; no row inherits the workspace role.
 * `ProjectMemberModel.add` derives `workspace_id` from the project and locks the workspace
 * membership, and `WorkspaceMemberModel.removeMember` deletes the overrides, so the
 * project/workspace/member consistency lives in the models rather than composite FKs.
 */
export const projectMembers = pgTable(
  'project_members',
  {
    id: uuid('id').defaultRandom().notNull().primaryKey(),
    projectId: text('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    addedByUserId: text('added_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    role: text('role').$type<ProjectMemberRole>().notNull().default('member'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('project_members_project_user_unique').on(t.projectId, t.userId),
    index('project_members_workspace_id_idx').on(t.workspaceId),
    index('project_members_user_id_idx').on(t.userId),
  ],
);

export type NewProjectMember = typeof projectMembers.$inferInsert;
export type ProjectMemberItem = typeof projectMembers.$inferSelect;
