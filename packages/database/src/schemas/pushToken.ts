import { index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, timestamptz } from './_helpers';
import { users } from './user';

/**
 * Stores Expo push notification tokens registered by mobile clients.
 *
 * One row per (userId, deviceId) — a single user may have multiple devices
 * (e.g. iPhone + Android tablet), each receiving its own notifications.
 *
 * Tokens are validated at registration time but may become invalid over time
 * (app uninstall, OS reinstall). Cleanup happens via the Expo receipt cron
 * (see cloud-side `process-push-receipts` worker).
 */
export const pushTokens = pgTable(
  'push_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** Expo push token, format `ExponentPushToken[xxx]` */
    expoToken: text('expo_token').notNull(),

    /** Stable device id persisted on the client (expo-secure-store) */
    deviceId: text('device_id').notNull(),

    /** `ios` | `android` */
    platform: text('platform').notNull(),

    appVersion: text('app_version'),
    locale: text('locale'),

    createdAt: createdAt(),
    lastSeenAt: timestamptz('last_seen_at').defaultNow().notNull(),
  },
  (table) => [
    /** Same user + device = one row; re-registration upserts in place */
    uniqueIndex('idx_push_tokens_user_device').on(table.userId, table.deviceId),
    /** PushChannel.deliver fans out by userId */
    index('idx_push_tokens_user').on(table.userId),
    /** Future: cleanup long-inactive tokens by lastSeenAt */
    index('idx_push_tokens_last_seen').on(table.lastSeenAt),
  ],
);

export type NewPushToken = typeof pushTokens.$inferInsert;
export type PushTokenItem = typeof pushTokens.$inferSelect;
