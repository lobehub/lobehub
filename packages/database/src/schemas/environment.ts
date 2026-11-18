import type { EnvironmentConfiguration } from '@lobechat/types';
import { isNotNull, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { projects } from './project';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * A working environment: the repositories to check out, the setup that makes
 * them usable and the variables every command sees. Registration alone neither
 * provisions compute nor persists files.
 *
 * Two kinds of row share the table. A row with `project_id` is that project's
 * environment — every project has exactly one, made with it, edited on the
 * project's own settings and never listed anywhere else. A row without one is a
 * standalone environment from「设置 → 环境」, picked per conversation.
 */
export const environments = pgTable(
  'environments',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    /** Personal owner, or creator in workspace scope. Retain until external cleanup completes. */
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'restrict' }),
    /**
     * The project this environment belongs to, or null for a standalone one.
     *
     * `restrict`: a project is deleted only after its environment has been
     * dealt with — removed when nothing was built from it, otherwise released
     * as standalone under a name of its own. Not `set null`, which would turn
     * it standalone under its project-derived name, collide with the
     * standalone name indexes and abort the deletion; and not `cascade`, since
     * instances reference the row with `restrict` and their builds live on the
     * execution plane.
     */
    projectId: text('project_id').references(() => projects.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    /** Registration availability, not the running/stopped state of an instance. */
    enabled: boolean('enabled').notNull().default(true),
    // Workspace rows only:
    //   - 'private' → only the creator (`user_id`) sees it; other members'
    //     environment lists and instance pickers never surface it.
    //   - 'public'  → every workspace member sees it and may run in its
    //     instances, the same bargain a shared device makes. What an instance
    //     captured comes with it, home directory included, so publishing is
    //     the deliberate act and 'private' is the default.
    // Ignored for personal rows (`workspace_id IS NULL` — implicitly private
    // to their owner). Filtered via `buildWorkspaceWhere`.
    visibility: text('visibility', { enum: ['private', 'public'] })
      .default('private')
      .notNull(),
    configuration: jsonb('configuration').$type<EnvironmentConfiguration>().notNull(),
    ...timestamps,
  },
  (t) => [
    index('environments_user_id_idx').on(t.userId),
    index('environments_workspace_id_idx').on(t.workspaceId),
    // One environment per project.
    uniqueIndex('environments_project_id_unique').on(t.projectId).where(isNotNull(t.projectId)),
    // The listing's own shape: one workspace, one visibility, then the creator
    // — which is the order `buildWorkspaceWhere` narrows in.
    index('environments_workspace_visibility_idx').on(t.workspaceId, t.visibility, t.userId),
    // The name is what a person picks an environment by, so it has to identify
    // one. Scoped to the MEMBER rather than the workspace: `user_id` records
    // the creator here, and two colleagues may each keep a "data analysis"
    // environment without either having to rename theirs. Sharing one into a
    // project goes through `project_environments`, which references a row
    // instead of matching it by name.
    //
    // A project's environment is named after the project and only ever shown
    // inside it, so it takes no part: two projects of the same name, or a
    // project named like a standalone environment, must not collide.
    uniqueIndex('environments_user_name_unique')
      .on(t.userId, t.name)
      .where(sql`${t.workspaceId} IS NULL AND ${t.projectId} IS NULL`),
    uniqueIndex('environments_workspace_user_name_unique')
      .on(t.workspaceId, t.userId, t.name)
      .where(sql`${t.workspaceId} IS NOT NULL AND ${t.projectId} IS NULL`),
    check('environments_name_not_empty', sql`length(btrim(${t.name})) > 0`),
    check('environments_configuration_object', sql`jsonb_typeof(${t.configuration}) = 'object'`),
  ],
);

export type NewEnvironment = typeof environments.$inferInsert;
export type EnvironmentItem = typeof environments.$inferSelect;
