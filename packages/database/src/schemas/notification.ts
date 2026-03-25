import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamptz, updatedAt } from './_helpers';
import { users } from './user';

export const notifications = pgTable(
  'notifications',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('notifications'))
      .notNull(),

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
    index('idx_notifications_user_active')
      .on(table.userId, table.createdAt)
      .where(sql`${table.isArchived} = false`),
    index('idx_notifications_user_unread')
      .on(table.userId)
      .where(sql`${table.isRead} = false AND ${table.isArchived} = false`),
    uniqueIndex('idx_notifications_dedupe').on(table.userId, table.dedupeKey),
  ],
);

export type NewNotification = typeof notifications.$inferInsert;
export type NotificationItem = typeof notifications.$inferSelect;

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('notificationDeliveries'))
      .notNull(),

    notificationId: text('notification_id')
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
  (table) => [index('idx_deliveries_notification').on(table.notificationId)],
);

export type NewNotificationDelivery = typeof notificationDeliveries.$inferInsert;
export type NotificationDeliveryItem = typeof notificationDeliveries.$inferSelect;
