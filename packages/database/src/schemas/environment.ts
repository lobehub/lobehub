import type { EnvironmentConfiguration } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
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
    /** Adapter identifier; the attached resource ID is scoped to this provider's configuration. */
    provider: text('provider').notNull(),
    /** Registration availability, not the running/stopped state of an instance. */
    enabled: boolean('enabled').notNull().default(true),
    configuration: jsonb('configuration').$type<EnvironmentConfiguration>().notNull(),
    /** Increment when changing configuration; executions can snapshot the version they consumed. */
    configurationVersion: integer('configuration_version').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    index('environments_user_id_idx').on(t.userId),
    index('environments_workspace_id_idx').on(t.workspaceId),
    check('environments_name_not_empty', sql`length(btrim(${t.name})) > 0`),
    check('environments_provider_not_empty', sql`length(btrim(${t.provider})) > 0`),
    check('environments_configuration_version_positive', sql`${t.configurationVersion} > 0`),
    check('environments_configuration_object', sql`jsonb_typeof(${t.configuration}) = 'object'`),
  ],
);

export type NewEnvironment = typeof environments.$inferInsert;
export type EnvironmentItem = typeof environments.$inferSelect;
