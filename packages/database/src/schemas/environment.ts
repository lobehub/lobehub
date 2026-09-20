import type { EnvironmentConfiguration } from '@lobechat/types';
import { isNotNull, isNull, sql } from 'drizzle-orm';
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
import { users } from './user';
import { workspaces } from './workspace';

/**
 * A reusable working environment. Projects associate with this resource without
 * taking ownership. Registration alone neither provisions compute nor persists files.
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
    // The listing's own shape: one workspace, one visibility, then the creator
    // — which is the order `buildWorkspaceWhere` narrows in.
    index('environments_workspace_visibility_idx').on(t.workspaceId, t.visibility, t.userId),
    // The name is what a person picks an environment by, so it has to identify
    // one. Scoped to the MEMBER rather than the workspace: `user_id` records
    // the creator here, and two colleagues may each keep a "data analysis"
    // environment without either having to rename theirs. Sharing one into a
    // project goes through `project_environments`, which references a row
    // instead of matching it by name.
    uniqueIndex('environments_user_name_unique').on(t.userId, t.name).where(isNull(t.workspaceId)),
    uniqueIndex('environments_workspace_user_name_unique')
      .on(t.workspaceId, t.userId, t.name)
      .where(isNotNull(t.workspaceId)),
    check('environments_name_not_empty', sql`length(btrim(${t.name})) > 0`),
    check('environments_configuration_object', sql`jsonb_typeof(${t.configuration}) = 'object'`),
  ],
);

export type NewEnvironment = typeof environments.$inferInsert;
export type EnvironmentItem = typeof environments.$inferSelect;
