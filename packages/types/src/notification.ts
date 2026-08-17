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

export interface NotificationMetadata {
  actor?: NotificationActor;
}
