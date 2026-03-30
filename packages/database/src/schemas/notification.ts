import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt } from './_helpers';
import { users } from './user';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** High-level grouping for preference toggles, e.g. `budget`, `subscription` */
    category: text('category').notNull(),
    /** Specific scenario type, e.g. `budget_exhausted`, `subscription_expiring` */
    type: text('type').notNull(),

    /** Notification title, used for email subject and inbox display */
    title: text('title').notNull(),
    /** Notification body text */
    content: text('content').notNull(),

    /** Idempotency key — same (userId, dedupeKey) pair prevents duplicate notifications */
    dedupeKey: text('dedupe_key'),
    /** URL to navigate to when user clicks the notification */
    actionUrl: text('action_url'),

    isRead: boolean('is_read').default(false).notNull(),
    /** Archived notifications are hidden from inbox but not deleted */
    isArchived: boolean('is_archived').default(false).notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /** General-purpose FK index for cascade deletes and unfiltered queries */
    index('idx_notifications_user').on(table.userId),
    /** Inbox list: non-archived notifications ordered by time, with cursor pagination */
    index('idx_notifications_user_active')
      .on(table.userId, table.createdAt)
      .where(sql`${table.isArchived} = false`),
    /** Unread count and mark-all-as-read queries */
    index('idx_notifications_user_unread')
      .on(table.userId)
      .where(sql`${table.isRead} = false AND ${table.isArchived} = false`),
    /** Idempotent notification creation via ON CONFLICT */
    uniqueIndex('idx_notifications_dedupe').on(table.userId, table.dedupeKey),
    /** Cron cleanup: find archived notifications older than retention period */
    index('idx_notifications_archived_cleanup')
      .on(table.updatedAt, table.createdAt, table.id)
      .where(sql`${table.isArchived} = true`),
  ],
);

export type NewNotification = typeof notifications.$inferInsert;
export type NotificationItem = typeof notifications.$inferSelect;

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    notificationId: uuid('notification_id')
      .references(() => notifications.id, { onDelete: 'cascade' })
      .notNull(),

    /** Delivery channel: `inbox` or `email` */
    channel: text('channel').$type<'email' | 'inbox'>().notNull(),
    /** Lifecycle status: `pending` | `sent` | `delivered` | `failed` */
    status: text('status').$type<'delivered' | 'failed' | 'pending' | 'sent'>().notNull(),

    /** ID returned by the channel provider, e.g. Resend messageId */
    providerMessageId: text('provider_message_id'),
    /** Error description when status is `failed` */
    failedReason: text('failed_reason'),
    sentAt: timestamptz('sent_at'),

    createdAt: createdAt(),
  },
  (table) => [
    /** FK lookup for cascade deletes when parent notification is removed */
    index('idx_deliveries_notification').on(table.notificationId),
    /** Dashboard: filter deliveries by channel */
    index('idx_deliveries_channel').on(table.channel),
    /** Dashboard: filter deliveries by status */
    index('idx_deliveries_status').on(table.status),
  ],
);

export type NewNotificationDelivery = typeof notificationDeliveries.$inferInsert;
export type NotificationDeliveryItem = typeof notificationDeliveries.$inferSelect;
