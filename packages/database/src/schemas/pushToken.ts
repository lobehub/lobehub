import type { ApnsEnvironment } from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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

    /** APNs environment used by native ActivityKit pushes. */
    apnsEnvironment: text('apns_environment').$type<ApnsEnvironment>(),

    appVersion: text('app_version'),
    locale: text('locale'),

    /** App-wide ActivityKit token used to start a Live Activity remotely. */
    liveActivityPushToStartToken: text('live_activity_push_to_start_token'),

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
    check(
      'push_tokens_apns_environment_check',
      sql`${table.apnsEnvironment} IS NULL OR ${table.apnsEnvironment} IN ('sandbox', 'production')`,
    ),
  ],
);

export type NewPushToken = typeof pushTokens.$inferInsert;
export type PushTokenItem = typeof pushTokens.$inferSelect;

/**
 * Per-activity ActivityKit update tokens. A user may have concurrent approval
 * activities and multiple iOS devices, so these cannot live as one column on
 * `push_tokens`.
 */
export const pushLiveActivities = pgTable(
  'push_live_activities',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    deviceId: text('device_id').notNull(),
    /** Opaque durable key shared by one sealed intervention batch/activity. */
    activityKey: text('activity_key').notNull(),
    /** Diagnostic grouping only; never use it to update/end one activity. */
    operationId: text('operation_id').notNull(),
    activityId: text('activity_id').notNull(),
    pushToken: text('push_token').notNull(),
    apnsEnvironment: text('apns_environment').$type<ApnsEnvironment>().notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamptz('last_seen_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_push_live_activities_user_device_activity').on(
      table.userId,
      table.deviceId,
      table.activityKey,
    ),
    index('idx_push_live_activities_user_activity').on(table.userId, table.activityKey),
    index('idx_push_live_activities_user_operation').on(table.userId, table.operationId),
    index('idx_push_live_activities_last_seen').on(table.lastSeenAt),
    check(
      'push_live_activities_apns_environment_check',
      sql`${table.apnsEnvironment} IN ('sandbox', 'production')`,
    ),
  ],
);

export type NewPushLiveActivity = typeof pushLiveActivities.$inferInsert;
export type PushLiveActivityItem = typeof pushLiveActivities.$inferSelect;
