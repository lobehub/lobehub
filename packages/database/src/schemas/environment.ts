import type { EnvironmentConfiguration } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';

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
    configuration: jsonb('configuration').$type<EnvironmentConfiguration>().notNull(),
    ...timestamps,
  },
  (t) => [
    index('environments_user_id_idx').on(t.userId),
    index('environments_workspace_id_idx').on(t.workspaceId),
    check('environments_name_not_empty', sql`length(btrim(${t.name})) > 0`),
    check('environments_configuration_object', sql`jsonb_typeof(${t.configuration}) = 'object'`),
  ],
);

export type NewEnvironment = typeof environments.$inferInsert;
export type EnvironmentItem = typeof environments.$inferSelect;
