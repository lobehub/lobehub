import { isNotNull, isNull } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { idGenerator, randomSlug } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { users } from './user';
import { workspaces } from './workspace';

//  ======= sessionGroups ======= //

export const sessionGroups = pgTable(
  'session_groups',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('sessionGroups'))
      .primaryKey(),
    name: text('name').notNull(),
    sort: integer('sort'),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    clientId: text('client_id'),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /**
     * Visibility within the owning workspace. `public` (default) means every
     * workspace member can see the folder; `private` constrains it to the
     * creator (`user_id`). Ignored in personal mode.
     */
    visibility: text('visibility', { enum: ['private', 'public'] })
      .default('public')
      .notNull(),

    ...timestamps,
  },
  (table) => ({
    clientIdUnique: uniqueIndex('session_groups_client_id_user_id_unique').on(
      table.clientId,
      table.userId,
    ),
    userIdIdx: index('session_groups_user_id_idx').on(table.userId),
    workspaceIdIdx: index('session_groups_workspace_id_idx').on(table.workspaceId),
    workspaceVisibilityIdx: index('session_groups_workspace_visibility_idx').on(
      table.workspaceId,
      table.visibility,
      table.userId,
    ),
  }),
);

export const insertSessionGroupSchema = createInsertSchema(sessionGroups);

export type NewSessionGroup = typeof sessionGroups.$inferInsert;
export type SessionGroupItem = typeof sessionGroups.$inferSelect;

//  ======= sessions ======= //

export const sessions = pgTable(
  'sessions',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('sessions'))
      .primaryKey(),
    slug: varchar('slug', { length: 100 })
      .notNull()
      .$defaultFn(() => randomSlug()),
    title: text('title'),
    description: text('description'),
    avatar: text('avatar'),
    backgroundColor: text('background_color'),

    type: text('type', { enum: ['agent', 'group'] }).default('agent'),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    groupId: text('group_id').references(() => sessionGroups.id, { onDelete: 'set null' }),
    clientId: text('client_id'),
    pinned: boolean('pinned').default(false),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('slug_user_id_unique').on(t.slug, t.userId).where(isNull(t.workspaceId)),
    uniqueIndex('sessions_client_id_user_id_unique').on(t.clientId, t.userId),

    index('sessions_user_id_idx').on(t.userId),
    index('sessions_id_user_id_idx').on(t.id, t.userId),
    index('sessions_user_id_updated_at_idx').on(t.userId, t.updatedAt),
    index('sessions_group_id_idx').on(t.groupId),
    index('sessions_workspace_id_idx').on(t.workspaceId),
    uniqueIndex('sessions_slug_workspace_id_unique')
      .on(t.workspaceId, t.slug)
      .where(isNotNull(t.workspaceId)),
  ],
);

export const insertSessionSchema = createInsertSchema(sessions);
// export const selectSessionSchema = createSelectSchema(sessions);

export type NewSession = typeof sessions.$inferInsert;
export type SessionItem = typeof sessions.$inferSelect;
