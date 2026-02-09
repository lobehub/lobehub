/* eslint-disable sort-keys-fix/sort-keys-fix  */
import { boolean, index, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { createNanoId } from '../utils/idGenerator';
import { timestamps, timestamptz } from './_helpers';
import { users } from './user';

export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id')
      .$defaultFn(() => createNanoId(16)())
      .notNull()
      .primaryKey(),
    name: varchar('name', { length: 256 }).notNull(), // name of the API key
    key: varchar('key', { length: 256 }).notNull().unique(), // API key
    enabled: boolean('enabled').default(true), // whether the API key is enabled
    expiresAt: timestamptz('expires_at'), // expires time
    lastUsedAt: timestamptz('last_used_at'), // last used time
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(), // belongs to user, when user is deleted, the API key will be deleted

    ...timestamps,
  },
  (t) => [index('api_keys_user_id_idx').on(t.userId)],
);

export const insertApiKeySchema = createInsertSchema(apiKeys);

export type ApiKeyItem = typeof apiKeys.$inferSelect;
export type NewApiKeyItem = typeof apiKeys.$inferInsert;
