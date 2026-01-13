/* eslint-disable sort-keys-fix/sort-keys-fix  */
import { DEFAULT_PREFERENCE } from '@lobechat/const';
import type { CustomPluginParams, UserOnboarding } from '@lobechat/types';
import type { LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, primaryKey, text, varchar } from 'drizzle-orm/pg-core';

import { timestamps, timestamptz, varchar255 } from './_helpers';

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey().notNull(),
    username: text('username').unique(),
    email: text('email').unique(),
    normalizedEmail: text('normalized_email').unique(),

    avatar: text('avatar'),
    phone: text('phone').unique(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    fullName: text('full_name'),
    interests: varchar('interests', { length: 64 }).array(),

    isOnboarded: boolean('is_onboarded').default(false),
    onboarding: jsonb('onboarding').$type<UserOnboarding>(),
    // Time user was created in Clerk
    clerkCreatedAt: timestamptz('clerk_created_at'),

    // Required by better-auth
    emailVerified: boolean('email_verified').default(false).notNull(),
    // Required by nextauth, all null allowed
    emailVerifiedAt: timestamptz('email_verified_at'),

    preference: jsonb('preference').$defaultFn(() => DEFAULT_PREFERENCE),

    // better-auth admin
    role: text('role'),
    banned: boolean('banned').default(false),
    banReason: text('ban_reason'),
    banExpires: timestamptz('ban_expires'),

    // better-auth two-factor
    twoFactorEnabled: boolean('two_factor_enabled').default(false),

    // better-auth phone number
    phoneNumberVerified: boolean('phone_number_verified'),
    lastActiveAt: timestamptz('last_active_at').notNull().defaultNow(),

    ...timestamps,
  },
  (table) => [
    index('users_email_idx').on(table.email),
    index('users_username_idx').on(table.username),
    index('users_created_at_idx').on(table.createdAt),
    /**
     * Partial index to speed up admin queries on banned users.
     * Only rows with banned=true are indexed.
     */
    index('users_banned_true_created_at_idx')
      .on(table.createdAt)
      .where(sql`${table.banned} = true`),
  ],
);

export type NewUser = typeof users.$inferInsert;
export type UserItem = typeof users.$inferSelect;

export const userSettings = pgTable('user_settings', {
  id: text('id')
    .references(() => users.id, { onDelete: 'cascade' })
    .primaryKey(),

  tts: jsonb('tts'),
  hotkey: jsonb('hotkey'),
  keyVaults: text('key_vaults'),
  general: jsonb('general'),
  languageModel: jsonb('language_model'),
  systemAgent: jsonb('system_agent'),
  defaultAgent: jsonb('default_agent'),
  market: jsonb('market'),
  memory: jsonb('memory'),
  tool: jsonb('tool'),
  image: jsonb('image'),
});
export type UserSettingsItem = typeof userSettings.$inferSelect;

export const userInstalledPlugins = pgTable(
  'user_installed_plugins',
  {
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    identifier: text('identifier').notNull(),
    type: text('type', { enum: ['plugin', 'customPlugin'] }).notNull(),
    manifest: jsonb('manifest').$type<LobeChatPluginManifest>(),
    settings: jsonb('settings'),
    customParams: jsonb('custom_params').$type<CustomPluginParams>(),
    source: varchar255('source'),
    ...timestamps,
  },
  (self) => ({
    id: primaryKey({ columns: [self.userId, self.identifier] }),
  }),
);

export type NewInstalledPlugin = typeof userInstalledPlugins.$inferInsert;
export type InstalledPluginItem = typeof userInstalledPlugins.$inferSelect;
