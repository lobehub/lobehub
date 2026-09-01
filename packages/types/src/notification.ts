/** APNs gateway selected by the signing profile that produced a native token. */
export type ApnsEnvironment = 'production' | 'sandbox';

/**
 * The person who triggered a user-driven notification (member joined,
 * invitation, comment activity). Snapshotted at send time so inbox surfaces
 * can render an avatar without cross-user lookups; absent for system- or
 * agent-driven notifications.
 */
export interface NotificationActor {
  avatar?: string;
  name?: string;
  userId?: string;
}

/**
 * The agent behind an agent-driven notification (e.g. a scheduled task tick).
 * Snapshotted at send time so inbox surfaces can render the agent's avatar
 * even when the agent isn't loaded client-side; live store data (looked up by
 * `id`) takes precedence when available.
 */
export interface NotificationAgent {
  avatar?: string;
  backgroundColor?: string;
  id: string;
  name?: string;
}

export interface NotificationMetadata {
  actor?: NotificationActor;
  agent?: NotificationAgent;
  /**
   * Link to the resource-transfer request this notification is about. Inbox
   * surfaces use it to pair the immutable row with the live request: while
   * the request is still pending the actionable live item replaces the row,
   * and once resolved the row stands alone as the historical record.
   */
  transfer?: { requestId: string };
}
