/* eslint-disable sort-keys-fix/sort-keys-fix  */
import { boolean, index, integer, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { idGenerator, randomSlug } from '../utils/idGenerator';
import { timestamps } from './_helpers';
import { users } from './user';

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
    ...timestamps,
  },
  (table) => ({
    clientIdUnique: uniqueIndex('session_groups_client_id_user_id_unique').on(
      table.clientId,
      table.userId,
    ),
    userIdIdx: index('session_groups_user_id_idx').on(table.userId),
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

    ...timestamps,
  },
  (t) => [
    uniqueIndex('slug_user_id_unique').on(t.slug, t.userId),
    uniqueIndex('sessions_client_id_user_id_unique').on(t.clientId, t.userId),

    index('sessions_user_id_idx').on(t.userId),
    index('sessions_id_user_id_idx').on(t.id, t.userId),
    index('sessions_user_id_updated_at_idx').on(t.userId, t.updatedAt),
    index('sessions_group_id_idx').on(t.groupId),
  ],
);

export const insertSessionSchema = createInsertSchema(sessions);
// export const selectSessionSchema = createSelectSchema(sessions);

export type NewSession = typeof sessions.$inferInsert;
export type SessionItem = typeof sessions.$inferSelect;
