/**
 * Push notification channel contract.
 *
 * Structurally compatible with cloud's `NotificationChannel` interface so
 * cloud can register `PushChannel` directly into its `channelInstances` map
 * without any cast (TypeScript structural typing).
 *
 * Self-host (OSS-only) callers can also instantiate `PushChannel` directly
 * and call `.deliver(ctx)` with a minimal context — `userEmail` is accepted
 * but ignored by the push implementation.
 */
export interface PushDeliveryContext {
  /** URL to navigate to when user taps the notification (sent as `data.url`) */
  actionUrl?: string;
  /** Notification body text */
  content: string;
  /** Underlying notifications.id — sent as `data.notificationId` for tracing */
  notificationId: string;
  /** Notification title */
  title: string;
  /** Ignored by push (kept for cloud `NotificationChannel` compatibility) */
  userEmail?: string;
  /** Target user — push channel fans out to all of this user's `push_tokens` */
  userId: string;
}

export interface PushDeliveryResult {
  failedReason?: string;
  /**
   * JSON-encoded `[{ ticketId, expoToken }, ...]` so the receipt cron can
   * map ticket IDs back to the originating token (for invalid-token cleanup).
   * `undefined` when nothing was sent (e.g. `no_tokens`).
   */
  providerMessageId?: string;
  status: 'delivered' | 'failed' | 'sent';
}

/** Persisted (ticketId → expoToken) mapping shape, embedded in providerMessageId */
export interface PushTicketRecord {
  expoToken: string;
  ticketId: string;
}
