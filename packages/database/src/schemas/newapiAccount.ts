import { index, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { timestamps, timestamptz } from './_helpers';
import { users } from './user';

export type UserNewApiAccountStatus = 'active' | 'failed' | 'pending';

/**
 * Per-user NewAPI account binding.
 *
 * LobeHub owns the local user identity, while NewAPI owns model billing and the
 * web console session. This table keeps the stable external NewAPI user id and
 * lifecycle status so signup provisioning can be retried safely.
 */
export const userNewApiAccounts = pgTable(
  'user_newapi_accounts',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** User id returned by the NewAPI provisioning endpoint. */
    newapiUserId: text('newapi_user_id'),
    status: varchar('status', { length: 20 }).$type<UserNewApiAccountStatus>().notNull(),
    lastProvisionError: text('last_provision_error'),
    lastProvisionedAt: timestamptz('last_provisioned_at'),

    ...timestamps,
  },
  (table) => [
    uniqueIndex('user_newapi_accounts_newapi_user_id_unique').on(table.newapiUserId),
    index('user_newapi_accounts_status_idx').on(table.status),
  ],
);

export type NewUserNewApiAccount = typeof userNewApiAccounts.$inferInsert;
export type UserNewApiAccountItem = typeof userNewApiAccounts.$inferSelect;
