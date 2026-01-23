import { boolean, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

import { users } from './user';

/**
 * NextAuth account type (oauth, email, credentials, etc.)
 * Previously imported from next-auth/adapters, now defined locally to remove dependency
 */
type AccountType = 'credentials' | 'email' | 'oauth' | 'oidc' | 'webauthn';

/**
 * This table stores nextauth accounts. This is used to link users to their sso profiles.
 * @see {@link https://authjs.dev/guides/creating-a-database-adapter#database-session-management | NextAuth Doc}
 */
export const nextauthAccounts = pgTable(
  `nextauth_accounts`,
  {
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    id_token: text('id_token'),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    scope: text('scope'),
    session_state: text('session_state'),
    token_type: text('token_type'),
    type: text('type').$type<AccountType>().notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (account) => ({
    compositePk: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  }),
);

/**
 * This table stores nextauth sessions.
 * NextAuth will use this table to store user sessions
 * which will enable remote logout and other features.
 * @see {@link https://authjs.dev/guides/creating-a-database-adapter#database-session-management | NextAuth Doc}
 */
export const nextauthSessions = pgTable(`nextauth_sessions`, {
  expires: timestamp('expires', { mode: 'date' }).notNull(),
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
});

/**
 * @description This table stores nextauth verification tokens.
 * @see {@link https://authjs.dev/guides/creating-a-database-adapter#verification-tokens | NextAuth Doc}
 */
export const nextauthVerificationTokens = pgTable(
  `nextauth_verificationtokens`,
  {
    expires: timestamp('expires', { mode: 'date' }).notNull(),
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
  },
  (verficationToken) => ({
    compositePk: primaryKey({
      columns: [verficationToken.identifier, verficationToken.token],
    }),
  }),
);

/**
 * @description This table stores nextauth authenticators.
 * @see {@link https://authjs.dev/reference/core/types#authenticator | NextAuth Doc }
 */
export const nextauthAuthenticators = pgTable(
  `nextauth_authenticators`,
  {
    counter: integer('counter').notNull(),
    credentialBackedUp: boolean('credentialBackedUp').notNull(),
    credentialDeviceType: text('credentialDeviceType').notNull(),
    credentialID: text('credentialID').notNull().unique(),
    credentialPublicKey: text('credentialPublicKey').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    transports: text('transports'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (authenticator) => ({
    compositePK: primaryKey({
      columns: [authenticator.userId, authenticator.credentialID],
    }),
  }),
);
