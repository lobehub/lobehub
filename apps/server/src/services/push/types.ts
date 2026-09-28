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
  /**
   * URL to navigate to when the user taps the notification (sent verbatim as
   * `data.url`). Universal-link/cold-start surfaces should provide an absolute
   * HTTPS URL; legacy in-app routes may remain relative.
   */
  actionUrl?: string;
  /** Notification body text */
  content: string;
  /** Underlying notifications.id — sent as `data.notificationId` for tracing */
  notificationId: string;
  /** Optional native presentation hints for notification service extensions. */
  pushPresentation?: {
    /** Extra JSON-safe string values merged into Expo's custom data payload. */
    data?: Record<string, string>;
    /**
     * Device ids that already received the same notification through another
     * system surface (for example ActivityKit). They are excluded from the
     * ordinary Expo push while all other registered devices retain fallback.
     */
    excludeDeviceIds?: string[];
    /** Public HTTPS image used by supported system notification surfaces. */
    image?: string;
    /** Sets APNs `mutable-content: 1` so an iOS service extension can enrich the alert. */
    mutableContent?: boolean;
  };
  /** Notification title */
  title: string;
  /** Scenario identifier sent in custom data for client/native routing. */
  type?: string;
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
