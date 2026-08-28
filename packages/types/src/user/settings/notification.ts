export interface NotificationChannelSettings {
  enabled?: boolean;
  /** Per-type overrides grouped by category. Missing = use scenario default (true) */
  items?: Record<string, Record<string, boolean>>;
}

/**
 * IM channel settings live in two surfaces with different shapes:
 * - PERSONAL settings use `platforms` — each messenger platform is configured
 *   like a standalone channel (master switch + per-type overrides), because
 *   account links follow the person.
 * - WORKSPACE per-member preferences use the inherited `enabled`/`items` —
 *   a scenario-level gate for "does this workspace's events reach my IM at
 *   all"; the platform pick still comes from the personal settings.
 */
export interface IMPlatformNotificationSettings extends NotificationChannelSettings {
  /**
   * Which linked workspace the bot DMs, for platforms that span several (Slack).
   * Missing — or pointing at a workspace the user has since unlinked — falls
   * back to the first linked one, so the setting can never strand delivery.
   */
  tenantId?: string;
}

export interface IMNotificationChannelSettings extends NotificationChannelSettings {
  /** Per-platform channel settings keyed by messenger platform id (e.g. `telegram`). Missing platform = enabled with every type on. */
  platforms?: Record<string, IMPlatformNotificationSettings>;
}

export interface NotificationSettings {
  email?: NotificationChannelSettings;
  /**
   * IM notifications delivered to the user's DM with the platform System Bot
   * (e.g. Telegram / Discord / Slack / WeChat). Only takes effect for users
   * with a linked messenger account — see `messenger_account_links` table.
   */
  im?: IMNotificationChannelSettings;
  inbox?: NotificationChannelSettings;
  /**
   * Mobile push notifications (delivered via Expo Push Service → APNs/FCM).
   * Only takes effect for users with a registered Expo push token —
   * see `push_tokens` table.
   */
  push?: NotificationChannelSettings;
}
